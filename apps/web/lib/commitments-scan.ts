// Commitments scanner. Sweeps recent email (last 14d of sent + received) and
// extracts PROMISES in both directions:
//   - OUTBOUND: things the user told someone they'd do ("I'll send the
//     proposal Friday", "I'll call you next week").
//   - INBOUND: things someone told the user they'd do ("I'll get back to
//     you by Thursday", "Will send over the deck tomorrow").
//
// Deadlines are extracted when stated; otherwise left null. Idempotent via
// dedup_key = lower(other_party) + trimmed commitment_text.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailProvider, type EmailSummary } from "@jarvis/integrations";

type ScanArgs = {
  title?: string;
  query?: string;
  max?: number;
  notify?: boolean;
};

type Extracted = {
  direction: "outbound" | "inbound";
  other_party: string;
  other_party_email: string | null;
  commitment_text: string;
  deadline: string | null;
  confidence: number;
  source_email_id: string;
  source_email_subject: string | null;
};

export type CommitmentsScanResult = {
  scanned_emails: number;
  new_commitments: number;
  updated_commitments: number;
  skipped: number;
  by_direction: { outbound: number; inbound: number };
  auto_closed: number;
};

type OpenOutbound = {
  id: string;
  other_party: string;
  other_party_email: string | null;
  commitment_text: string;
  deadline: string | null;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 8000;
const MAX_BODY_CHARS = 1500;

const DEFAULT_QUERY = "newer_than:14d (in:inbox OR in:sent)";

export async function runCommitmentsScanTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[commitments-scan] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") return;

  const args: ScanArgs = task.args ?? {};
  const query = args.query ?? DEFAULT_QUERY;
  const max = Math.min(Math.max(args.max ?? 40, 10), 100);

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", taskId);

  const emit = async (kind: "text" | "progress" | "error", content: string | null) => {
    await admin.from("task_events").insert({
      task_id: taskId,
      user_id: task.user_id,
      kind,
      content,
    });
  };

  try {
    const email = await getEmailProvider(admin, task.user_id);
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", task.user_id)
      .single();
    const userName = profile?.display_name ?? "the user";

    await emit("progress", `scanning last 14d via ${email.providerName} (max ${max})`);
    const raw = await email.list({ query, max });
    const emails: EmailSummary[] = raw.map((e) => ({
      ...e,
      body: e.body.slice(0, MAX_BODY_CHARS),
    }));
    await emit("progress", `fetched ${emails.length} email(s), extracting commitments…`);

    let extracted: Extracted[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    if (emails.length > 0) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const systemPrompt = buildSystemPrompt(userName);
      const userMsg = buildUserMessage(emails);

      let model = MODEL;
      let response: Anthropic.Messages.Message | null = null;
      for (let attempt = 0; attempt < 2 && !response; attempt++) {
        try {
          response = await anthropic.messages.create({
            model,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: [{ role: "user", content: userMsg }],
          });
        } catch (e) {
          if (attempt === 0 && isOverloadedError(e)) {
            model = FALLBACK_MODEL;
            continue;
          }
          throw e;
        }
      }
      if (!response) throw new Error("no response from model");

      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;

      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      extracted = parseExtracted(text, emails);
    }

    const persisted = await persistCommitments(admin, task.user_id, extracted);

    await emit("progress", "reconciling sent mail against open outbound promises…");
    const autoClosed = await reconcileOutboundFulfillment(admin, task.user_id, emails);
    if (autoClosed.closed > 0) {
      await emit(
        "progress",
        `auto-closed ${autoClosed.closed} outbound promise(s) from sent mail`,
      );
    }
    inputTokens += autoClosed.inputTokens;
    outputTokens += autoClosed.outputTokens;

    const result: CommitmentsScanResult = {
      scanned_emails: emails.length,
      new_commitments: persisted.newCount,
      updated_commitments: persisted.updatedCount,
      skipped: persisted.skipped,
      by_direction: persisted.byDirection,
      auto_closed: autoClosed.closed,
    };

    await admin
      .from("tasks")
      .update({
        status: "done",
        result: JSON.stringify(result),
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      })
      .eq("id", taskId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit("error", msg);
    await admin
      .from("tasks")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", taskId);
  }
}

function buildSystemPrompt(userName: string): string {
  return [
    `You are JARVIS's commitments-extractor. You receive ${userName}'s recent email`,
    "(both sent and received) and extract every PROMISE — a statement that",
    "someone will do something by some time.",
    "",
    "Two directions:",
    `- OUTBOUND: ${userName} promised THEM something. Sent by ${userName}.`,
    `  E.g. "I'll send the deck Friday", "I'll come back with pricing tomorrow".`,
    "- INBOUND: THEY promised something to " + userName + ". Sent by them.",
    `  E.g. "I'll get back to you by Thursday", "Will share the draft tonight".`,
    "",
    "Rules:",
    "- Skip vague pleasantries ('let's talk soon', 'catch up sometime').",
    "- Skip things already done ('sent' in past tense is not a promise).",
    "- Skip system/automated emails (notifications, receipts, marketing).",
    "- Extract a crisp one-line commitment_text in first person of the promiser",
    "  (e.g. 'Send pricing proposal', 'Share the Figma link', 'Confirm Tuesday slot').",
    "- other_party: the human on the OTHER side of the promise (never " + userName + "). Use their name if known from signature/From, else their email local-part.",
    "- deadline: ISO 8601 datetime if a concrete time is stated or clearly implied (parse 'Friday', 'next week', 'tomorrow', 'end of week' relative to the email's Date). null if vague.",
    "- confidence: 0.0-1.0 (skip < 0.5).",
    "",
    "Reply as a JSON array only — no prose, no markdown. Example:",
    '[{"direction":"outbound","other_party":"Ana Ruiz","other_party_email":"ana@acme.co","commitment_text":"Send the pricing proposal","deadline":"2026-04-26T17:00:00Z","confidence":0.9,"source_email_id":"abc"}]',
  ].join("\n");
}

function buildUserMessage(emails: EmailSummary[]): string {
  return emails
    .map(
      (e, i) =>
        `[email_id=${e.id}] [${i + 1}]\nFrom: ${e.from}\nTo: ${e.to ?? ""}\nSubject: ${e.subject}\nDate: ${e.date}\n\n${e.body}`,
    )
    .join("\n\n---\n\n");
}

function parseExtracted(text: string, emails: EmailSummary[]): Extracted[] {
  const cleaned = text.trim().replace(/^```json\n?|\n?```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const subjectByEmailId = new Map<string, string>();
  for (const e of emails) subjectByEmailId.set(e.id, e.subject ?? "");

  return parsed
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const direction = o.direction;
      if (direction !== "outbound" && direction !== "inbound") return null;
      if (typeof o.other_party !== "string" || !o.other_party.trim()) return null;
      if (typeof o.commitment_text !== "string" || !o.commitment_text.trim()) return null;
      if (typeof o.confidence !== "number" || o.confidence < 0.5) return null;
      if (typeof o.source_email_id !== "string") return null;
      return {
        direction,
        other_party: o.other_party.trim(),
        other_party_email: typeof o.other_party_email === "string" ? o.other_party_email : null,
        commitment_text: o.commitment_text.trim(),
        deadline: typeof o.deadline === "string" ? o.deadline : null,
        confidence: o.confidence,
        source_email_id: o.source_email_id,
        source_email_subject: subjectByEmailId.get(o.source_email_id) ?? null,
      } satisfies Extracted;
    })
    .filter((r): r is Extracted => r !== null);
}

function dedupKey(r: Extracted): string {
  return `${r.direction}|${r.other_party.toLowerCase()}|${r.commitment_text.toLowerCase().slice(0, 80)}`;
}

async function persistCommitments(
  admin: SupabaseClient,
  userId: string,
  rows: Extracted[],
): Promise<{
  newCount: number;
  updatedCount: number;
  skipped: number;
  byDirection: { outbound: number; inbound: number };
}> {
  let newCount = 0;
  let updatedCount = 0;
  let skipped = 0;
  const byDirection = { outbound: 0, inbound: 0 };

  for (const r of rows) {
    const key = dedupKey(r);
    const { data: existing } = await admin
      .from("commitments")
      .select("id, status")
      .eq("user_id", userId)
      .eq("dedup_key", key)
      .maybeSingle();

    if (existing) {
      await admin
        .from("commitments")
        .update({
          commitment_text: r.commitment_text,
          deadline: r.deadline,
          confidence: r.confidence,
          source_email_id: r.source_email_id,
          source_email_subject: r.source_email_subject,
          other_party_email: r.other_party_email,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id as string);
      updatedCount += 1;
    } else {
      const { error } = await admin.from("commitments").insert({
        user_id: userId,
        direction: r.direction,
        other_party: r.other_party,
        other_party_email: r.other_party_email,
        commitment_text: r.commitment_text,
        dedup_key: key,
        deadline: r.deadline,
        confidence: r.confidence,
        source_email_id: r.source_email_id,
        source_email_subject: r.source_email_subject,
      });
      if (error) {
        skipped += 1;
        continue;
      }
      newCount += 1;
    }
    byDirection[r.direction] += 1;
  }

  return { newCount, updatedCount, skipped, byDirection };
}

function isOverloadedError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const msg = String((e as { message?: string }).message ?? "").toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}

// Parse a "Full Name <addr@x>" or "addr@x" field into a lowercased email.
function extractEmail(field: string | null | undefined): string | null {
  if (!field) return null;
  const angle = field.match(/<([^>]+)>/);
  const raw = angle?.[1] ?? field.trim();
  const m = raw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

// Scan recent sent mail (drawn from the same email pull already done by the
// extractor) and mark open outbound commitments DONE when the sent email
// delivers the thing promised. Cheap: one Haiku call, scoped to
// (recipient has open promise) pairs only.
async function reconcileOutboundFulfillment(
  admin: SupabaseClient,
  userId: string,
  emails: EmailSummary[],
): Promise<{ closed: number; inputTokens: number; outputTokens: number }> {
  if (emails.length === 0) return { closed: 0, inputTokens: 0, outputTokens: 0 };

  const { data: openRows } = await admin
    .from("commitments")
    .select("id, other_party, other_party_email, commitment_text, deadline")
    .eq("user_id", userId)
    .eq("direction", "outbound")
    .eq("status", "open");
  const open: OpenOutbound[] = (openRows ?? []) as OpenOutbound[];
  if (open.length === 0) return { closed: 0, inputTokens: 0, outputTokens: 0 };

  // Index open commitments by recipient email for fast match.
  const openByEmail = new Map<string, OpenOutbound[]>();
  const openByNameKey = new Map<string, OpenOutbound[]>();
  for (const c of open) {
    if (c.other_party_email) {
      const k = c.other_party_email.toLowerCase();
      if (!openByEmail.has(k)) openByEmail.set(k, []);
      openByEmail.get(k)!.push(c);
    }
    const nk = c.other_party.toLowerCase().trim();
    if (nk.length >= 3) {
      if (!openByNameKey.has(nk)) openByNameKey.set(nk, []);
      openByNameKey.get(nk)!.push(c);
    }
  }

  // For each email, find candidate open commitments. Only care about sent
  // mail — but the pull mixes inbox+sent. We heuristically treat any email
  // where the `to` field has a recipient with open outbound promises as a
  // candidate; the LLM final check filters false positives.
  type Candidate = {
    email: EmailSummary;
    candidates: OpenOutbound[];
  };
  const pairs: Candidate[] = [];
  for (const e of emails) {
    const toEmail = extractEmail(e.to);
    const matches = new Map<string, OpenOutbound>();
    if (toEmail) {
      for (const c of openByEmail.get(toEmail) ?? []) matches.set(c.id, c);
    }
    // Name-based fallback — covers commitments where we don't have the
    // recipient email recorded.
    if (matches.size === 0 && e.to) {
      const toLower = e.to.toLowerCase();
      for (const [nk, cs] of openByNameKey) {
        if (toLower.includes(nk)) {
          for (const c of cs) matches.set(c.id, c);
        }
      }
    }
    if (matches.size > 0) {
      pairs.push({ email: e, candidates: [...matches.values()] });
    }
  }
  if (pairs.length === 0) return { closed: 0, inputTokens: 0, outputTokens: 0 };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const systemPrompt = [
    "You are JARVIS's fulfillment-reconciler. For each sent email + candidate",
    "open commitments the user made TO that recipient, decide which (if any)",
    "the email FULFILLS — i.e. actually delivers the thing the user promised.",
    "",
    "Rules:",
    "- 'Promised to send the deck' + sent email with deck attached / link → FULFILLED.",
    "- 'Promised to confirm Tuesday slot' + sent email saying 'yes Tuesday works' → FULFILLED.",
    "- 'Will call you tomorrow' + sent email → NOT fulfilled (call is not an email).",
    "- 'Will send pricing Friday' + sent email asking 'what do you want to see?' → NOT fulfilled (no delivery).",
    "- If unsure, do NOT mark fulfilled. False positives are much worse than false negatives here.",
    "- Only consider emails where the From header looks like the user (i.e.",
    "  NOT when the user is the To). You can infer direction from headers.",
    "",
    "Reply as a JSON array only — no prose, no markdown.",
    'Each item: {"commitment_id":"<uuid>","email_id":"<id>","note":"one-line reason"}',
    "Return [] if nothing was fulfilled.",
  ].join("\n");

  const userMsg = pairs
    .map((p, i) => {
      const candidateLines = p.candidates
        .map(
          (c) =>
            `  - [id=${c.id}] "${c.commitment_text}" (to ${c.other_party}${c.deadline ? `, by ${c.deadline}` : ""})`,
        )
        .join("\n");
      return [
        `[email_id=${p.email.id}] [${i + 1}]`,
        `From: ${p.email.from}`,
        `To: ${p.email.to}`,
        `Subject: ${p.email.subject}`,
        `Date: ${p.email.date}`,
        "",
        `${p.email.body.slice(0, 1200)}`,
        "",
        "Candidate open commitments:",
        candidateLines,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  let response: Anthropic.Messages.Message | null = null;
  let model = MODEL;
  for (let attempt = 0; attempt < 2 && !response; attempt++) {
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      });
    } catch (e) {
      if (attempt === 0 && isOverloadedError(e)) {
        model = FALLBACK_MODEL;
        continue;
      }
      throw e;
    }
  }
  if (!response) return { closed: 0, inputTokens: 0, outputTokens: 0 };

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const cleaned = text.trim().replace(/^```json\n?|\n?```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) {
      return {
        closed: 0,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return {
        closed: 0,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    }
  }
  if (!Array.isArray(parsed)) {
    return {
      closed: 0,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  const subjectByEmailId = new Map<string, string>();
  for (const e of emails) subjectByEmailId.set(e.id, e.subject ?? "");
  const validIds = new Set(open.map((o) => o.id));

  let closed = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const cid = typeof o.commitment_id === "string" ? o.commitment_id : null;
    const eid = typeof o.email_id === "string" ? o.email_id : null;
    const note = typeof o.note === "string" ? o.note : "";
    if (!cid || !validIds.has(cid)) continue;

    const subject = eid ? subjectByEmailId.get(eid) ?? "" : "";
    const trail =
      `[auto-closed ${today}] fulfilled via sent email${subject ? ` "${subject}"` : ""}${note ? ` — ${note}` : ""}`;

    // Fetch current notes so we append rather than clobber.
    const { data: cur } = await admin
      .from("commitments")
      .select("notes")
      .eq("id", cid)
      .eq("user_id", userId)
      .maybeSingle();
    const merged = cur?.notes ? `${cur.notes}\n${trail}` : trail;

    const { error } = await admin
      .from("commitments")
      .update({
        status: "done",
        user_confirmed: true,
        notes: merged,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cid)
      .eq("user_id", userId)
      .eq("status", "open"); // avoid re-closing
    if (!error) closed += 1;
  }

  return {
    closed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
