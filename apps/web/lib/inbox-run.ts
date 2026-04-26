// Server-side runner for the inbox agent. Loads a queued inbox task, pulls
// matching emails via the user's configured EmailProvider (Gmail today;
// Outlook/IMAP pluggable), runs a single Anthropic call that classifies +
// drafts replies for the full batch, and stores structured JSON in tasks.result.
// Approval creates reply drafts (threaded) in bulk via the
// /api/tasks/[id]/approve endpoint.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailProvider, type EmailSummary } from "@jarvis/integrations";
import { dispatchNotification } from "./notify";

type InboxArgs = {
  title?: string;
  query?: string;
  max?: number;
  notify?: boolean;
};

type Classification = "needs_reply" | "fyi" | "newsletter" | "spam" | "action_required";

export type InboxEmail = EmailSummary;

export type InboxEntry = {
  email: InboxEmail;
  classification: Classification;
  priority: "high" | "medium" | "low";
  reason: string;
  suggested_reply?: { subject: string; body: string };
};

export type InboxResult = {
  query: string;
  count: number;
  entries: InboxEntry[];
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 6000;
// Trim long email bodies before sending to the model — cold outreach sequences
// and marketing mail can be huge and aren't useful for triage beyond the top.
const MAX_BODY_CHARS = 1500;

export async function runInboxTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[inbox-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[inbox-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: InboxArgs = task.args ?? {};
  const notify = args.notify ?? true;
  const query = args.query ?? "is:unread newer_than:1d";
  const max = Math.min(Math.max(args.max ?? 15, 1), 30);

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", taskId);

  const emit = async (
    kind: "text" | "progress" | "error",
    content: string | null,
    data: Record<string, unknown> | null = null,
  ) => {
    await admin.from("task_events").insert({
      task_id: taskId,
      user_id: task.user_id,
      kind,
      content,
      data,
    });
  };

  try {
    const email = await getEmailProvider(admin, task.user_id);

    await emit("progress", `fetching emails via ${email.providerName}: ${query} (max ${max})`);
    const raw = await email.list({ query, max });
    // Trim bodies for the LLM call — triage doesn't need 20KB of marketing copy.
    const emails: InboxEmail[] = raw.map((e) => ({ ...e, body: e.body.slice(0, MAX_BODY_CHARS) }));
    await emit("progress", `fetched ${emails.length} email(s), classifying…`);

    if (emails.length === 0) {
      const result: InboxResult = { query, count: 0, entries: [] };
      await admin
        .from("tasks")
        .update({
          status: "needs_approval",
          needs_approval_at: new Date().toISOString(),
          result: JSON.stringify(result),
          completed_at: new Date().toISOString(),
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
        })
        .eq("id", taskId);
      if (notify) await queueNotification(admin, task.user_id, taskId, args.title, 0, 0);
      return;
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const systemPrompt = buildSystemPrompt();
    const userMsg = buildUserMessage(emails);

    let model = MODEL;
    let modelSwitched = false;
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
        if (!modelSwitched && isOverloadedError(e)) {
          modelSwitched = true;
          model = FALLBACK_MODEL;
          await emit("progress", `model overloaded, switching to ${FALLBACK_MODEL}`);
          continue;
        }
        throw e;
      }
    }
    if (!response) throw new Error("no response from model");

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cacheRead = response.usage.cache_read_input_tokens ?? 0;

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const entries = parseEntries(text, emails);
    const result: InboxResult = { query, count: entries.length, entries };
    const costUsd = estimateCost(inputTokens, outputTokens, cacheRead);
    const replyCount = entries.filter((e) => e.suggested_reply).length;

    await admin
      .from("tasks")
      .update({
        status: "needs_approval",
        needs_approval_at: new Date().toISOString(),
        result: JSON.stringify(result),
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheRead,
        cost_usd: costUsd,
      })
      .eq("id", taskId);

    if (notify) {
      await queueNotification(admin, task.user_id, taskId, args.title, entries.length, replyCount);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit("error", msg);
    await admin
      .from("tasks")
      .update({
        status: "failed",
        error: msg,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
  }
}

function buildSystemPrompt(): string {
  return [
    "You are the inbox-triage agent in Vance, Reiss's multi-agent personal assistant.",
    "You receive a batch of recent emails and return a structured triage for each.",
    "",
    "Writing as: Reiss (solo non-technical founder of SevenPoint AI, British).",
    "Default tone for drafts: warm, direct, British English, no corporate filler, no",
    "em-dashes in casual mail. Short and human.",
    "",
    "For EACH email, return:",
    "- classification: one of 'needs_reply', 'fyi', 'newsletter', 'spam', 'action_required'",
    "  - needs_reply: a human is waiting for a response from Reiss",
    "  - action_required: Reiss needs to DO something (book a call, sign a doc, pay) — no",
    "    reply needed, just action",
    "  - fyi: informational, no response required",
    "  - newsletter: bulk/marketing mail",
    "  - spam: probable spam/phishing",
    "- priority: 'high' | 'medium' | 'low'",
    "- reason: one short sentence explaining the classification",
    "- suggested_reply: ONLY for classification='needs_reply'. { subject, body }",
    "  - subject: usually 'Re: <original>' (you provide)",
    "  - body: the draft. Short (3-6 lines), sign off as 'Reiss' or '— Reiss'.",
    "  - If you can't confidently draft (missing info, ambiguous), skip the draft and keep",
    "    classification='needs_reply' with a reason like 'need more info from Reiss'.",
    "",
    "Output contract (STRICT — this is parsed):",
    "Return a single JSON object inside <triage>...</triage> tags:",
    "{",
    '  "entries": [',
    "    {",
    '      "email_id": "<message id>",',
    '      "classification": "...",',
    '      "priority": "...",',
    '      "reason": "...",',
    '      "suggested_reply": { "subject": "...", "body": "..." }  // optional',
    "    },",
    "    ...",
    "  ]",
    "}",
    "",
    "Do not include emails that weren't in the input. Do not invent facts or commitments.",
    "Do not wrap the JSON in markdown code fences — use the <triage> tags only.",
  ].join("\n");
}

function buildUserMessage(emails: InboxEmail[]): string {
  const parts = [`Triage the following ${emails.length} emails.\n`];
  for (const e of emails) {
    parts.push(
      [
        `--- EMAIL ${e.id} ---`,
        `From: ${e.from}`,
        `Subject: ${e.subject}`,
        `Date: ${e.date}`,
        "",
        e.body || e.snippet || "(no body)",
        "",
      ].join("\n"),
    );
  }
  parts.push("Return the triage JSON now, wrapped in <triage> tags.");
  return parts.join("\n");
}

function parseEntries(text: string, emails: InboxEmail[]): InboxEntry[] {
  const match = text.match(/<triage>([\s\S]*?)<\/triage>/i);
  const jsonStr = match?.[1]?.trim() ?? text.trim();
  let parsed: { entries?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Fall back: mark everything as fyi so the user still sees the emails.
    return emails.map((e) => ({
      email: e,
      classification: "fyi" as const,
      priority: "low" as const,
      reason: "failed to parse triage — review manually",
    }));
  }

  const byId = new Map(emails.map((e) => [e.id, e]));
  const out: InboxEntry[] = [];
  for (const raw of parsed.entries ?? []) {
    const id = String(raw.email_id ?? "");
    const email = byId.get(id);
    if (!email) continue;
    const classification = normalizeClassification(String(raw.classification ?? "fyi"));
    const priority = normalizePriority(String(raw.priority ?? "low"));
    const reason = String(raw.reason ?? "");
    const sr = raw.suggested_reply as { subject?: string; body?: string } | undefined;
    const suggestedReply =
      classification === "needs_reply" && sr && sr.subject && sr.body
        ? { subject: String(sr.subject), body: String(sr.body) }
        : undefined;
    out.push({ email, classification, priority, reason, suggested_reply: suggestedReply });
  }
  // Append any emails the model skipped entirely so nothing vanishes.
  for (const e of emails) {
    if (!out.find((entry) => entry.email.id === e.id)) {
      out.push({
        email: e,
        classification: "fyi",
        priority: "low",
        reason: "not classified by model",
      });
    }
  }
  return out;
}

function normalizeClassification(s: string): Classification {
  const v = s.toLowerCase().trim();
  if (v === "needs_reply" || v === "fyi" || v === "newsletter" || v === "spam" || v === "action_required") {
    return v;
  }
  return "fyi";
}

function normalizePriority(s: string): "high" | "medium" | "low" {
  const v = s.toLowerCase().trim();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "low";
}

function isOverloadedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}

function estimateCost(input: number, output: number, cacheRead: number): number {
  const inputNonCached = Math.max(0, input - cacheRead);
  const cost =
    (inputNonCached / 1_000_000) * 1.0 +
    (cacheRead / 1_000_000) * 0.1 +
    (output / 1_000_000) * 5.0;
  return Math.round(cost * 10000) / 10000;
}

async function queueNotification(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  title: string | undefined,
  total: number,
  replyCount: number,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return;

  const label = title ? `"${title}"` : "inbox triage";
  const body =
    total === 0
      ? `📥 ${label}: no emails matched. All clear.`
      : `📥 ${label}: ${total} triaged, ${replyCount} reply draft${replyCount === 1 ? "" : "s"} ready. Open JARVIS → Tasks to review.`;

  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
      task_id: taskId,
    })
    .select("id")
    .single();
  if (error || !notif) return;

  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[inbox-run] dispatch failed:", e);
  }
}
