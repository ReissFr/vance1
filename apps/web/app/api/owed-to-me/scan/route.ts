// POST /api/owed-to-me/scan — THE OWED-TO-ME LEDGER (§178).
//
// Body: { window_days?: 7-180 (default 60) }
//
// The clean inverse mirror of §175 said-i-would.
//   §175 said_i_woulds — promises THE USER made, owed BY them.
//   §178 owed_to_me     — promises OTHERS made TO the user, owed TO them.
//
// Mines the user's chats for casual reported promises FROM others —
// "she said she'd send it tomorrow", "the contractor promised the boiler
// by friday", "they said they'd get back to me next week", "my dad said
// he'd help with the deposit".
//
// THE NOVEL DIAGNOSTIC FIELD is RELATIONSHIP_WITH. Cross-tab on this
// field surfaces the implicit pattern: who's been quietly taking up your
// bandwidth with unkept promises?
//
// Server computes target_date AUTHORITATIVELY from horizon_kind +
// spoken_date. Never trust the model with date arithmetic.
//
// UPSERT-by-(user_id, spoken_message_id, promise_text).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 5000;

const VALID_HORIZON = new Set([
  "today", "tomorrow", "this_week", "this_weekend", "next_week",
  "this_month", "next_month", "soon", "eventually", "unspecified",
]);
const VALID_RELATIONSHIP = new Set([
  "partner", "parent", "sibling", "friend",
  "colleague", "boss", "client", "stranger", "unknown",
]);
const VALID_DOMAIN = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);
const VALID_RECENCY = new Set(["recent", "older"]);

// Trigger phrases for filtering reported-promise candidates. These are
// utterances where the user is RELAYING something someone else said.
const TRIGGER_RE = /\b(?:(?:he|she|they|dad|mum|mom)\s+(?:said|told me|promised)\s+(?:he|she|they|d|that|to|by|tomorrow|today|next|this|by)|(?:said|told me|promised)\s+(?:they|she|he|s?he)['']?d|(?:promised|said\s+(?:to\s+)?(?:get|let|have|send|give|show|bring|do|come|reply|help|tell|finish))|(?:supposed|meant)\s+to\s+(?:get back|hear|let me know|be|send|come|finish|reply|deliver|drop|drop off)|(?:still\s+)?(?:waiting|haven'?t heard)\s+(?:on|for|from|back from)|(?:i'?m\s+)?waiting (?:for|on)\s+(?:him|her|them|\w+)\s+to|gonna\s+(?:send|drop|do|get|finish|let me|tell|reply|come|help)|going to\s+(?:send|drop|do|get|finish|let me|tell|reply|come|help)|(?:was|were)\s+(?:gonna|going to)|by (?:tomorrow|tonight|friday|monday|tuesday|wednesday|thursday|saturday|sunday|the (?:end of|weekend))|(?:yet to|still hasn'?t|hasn'?t (?:come back|got back|replied|sent|done|finished|delivered))|never (?:heard back|got back to me|sent|replied)|hasn'?t (?:come|reached out|got|gotten) back)\b/i;

function dateOnly(iso: string): string { return iso.slice(0, 10); }

function computeTargetDate(spokenDate: string, kind: string): string {
  const base = new Date(`${spokenDate}T00:00:00Z`);
  const day = (n: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + n);
    return dateOnly(d.toISOString());
  };
  const dow = base.getUTCDay();

  switch (kind) {
    case "today": return spokenDate;
    case "tomorrow": return day(1);
    case "this_week": {
      const toFriday = (5 - dow + 7) % 7 || 5;
      return day(Math.min(5, toFriday));
    }
    case "this_weekend": {
      const toSaturday = (6 - dow + 7) % 7 || 6;
      return day(toSaturday);
    }
    case "next_week": return day(9);
    case "this_month": {
      const endOfMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
      const cap = day(14);
      return endOfMonth.getTime() < new Date(`${cap}T00:00:00Z`).getTime() ? dateOnly(endOfMonth.toISOString()) : cap;
    }
    case "next_month": return day(30);
    case "soon": return day(7);
    case "eventually": return day(60);
    case "unspecified":
    default:
      return day(14);
  }
}

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(7, Math.min(180, Math.round(body.window_days ?? 60)));
  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const todayDate = dateOnly(new Date().toISOString());
  const startDate = dateOnly(startIso);

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, role")
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", startIso)
    .order("created_at", { ascending: true })
    .limit(3000);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  type Msg = { id: string; conversation_id: string; content: string; created_at: string };
  const userMessages = (msgRows ?? []) as Msg[];

  if (userMessages.length < 5) {
    return NextResponse.json({ error: "not enough chat history in this window" }, { status: 400 });
  }

  const candidates = userMessages.filter((m) =>
    TRIGGER_RE.test(m.content) &&
    m.content.length >= 16 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no reported-promise messages found", latency_ms: Date.now() - t0 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 400 ? m.content.slice(0, 360) + " ..." : m.content,
  }));

  const SAMPLE_LIMIT = 160;
  const sampled: typeof trimmed = [];
  if (trimmed.length <= SAMPLE_LIMIT) {
    sampled.push(...trimmed);
  } else {
    const step = trimmed.length / SAMPLE_LIMIT;
    for (let i = 0; i < SAMPLE_LIMIT; i += 1) {
      const idx = Math.floor(i * step);
      const item = trimmed[idx];
      if (item) sampled.push(item);
    }
  }
  sampled.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const msgDates = new Map<string, string>();
  const msgConvos = new Map<string, string>();
  for (const m of sampled) {
    msgDates.set(m.id, dateOnly(m.created_at));
    msgConvos.set(m.id, m.conversation_id);
  }

  const lines: string[] = [];
  lines.push(`WINDOW: ${startDate} -> ${todayDate} (${windowDays} days)`);
  lines.push(`REPORTED-PROMISE CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting REPORTED PROMISES — utterances where the user is relaying something SOMEONE ELSE said they would do for them. Promises owed TO the user.",
    "",
    "Examples that QUALIFY:",
    "- 'she said she'd send the design files tomorrow' -> promise_text: 'send the design files'; horizon_text: 'tomorrow'; horizon_kind: tomorrow; relationship_with: colleague (or friend, depending on context); person_text: 'she' or named",
    "- 'the contractor promised the boiler would be done by friday' -> promise_text: 'finish the boiler'; horizon_text: 'by friday'; horizon_kind: this_week; relationship_with: stranger; person_text: 'the contractor'",
    "- 'my dad said he'd help with the deposit next month' -> promise_text: 'help with the deposit'; horizon_kind: next_month; relationship_with: parent; person_text: 'my dad'",
    "- 'still waiting for sarah to get back to me about the role' -> promise_text: 'get back about the role'; horizon_text: ''; horizon_kind: unspecified; relationship_with: colleague (or boss/client); person_text: 'sarah'",
    "- 'he was supposed to drop the keys off this weekend' -> promise_text: 'drop off the keys'; horizon_kind: this_weekend; person_text: 'he'",
    "",
    "DOES NOT qualify:",
    "- promises THE USER made ('I'll text her tomorrow') — that's §175 said-i-would.",
    "- formal commitments tracked elsewhere (the commitments table for outgoing).",
    "- abstract group statements with no actor ('they'll roll out the feature eventually' — vague).",
    "- speculation or hope ('hopefully he'll send it', 'maybe she'll reply') — not a stated promise.",
    "- already-fulfilled in same message ('she said she'd send it — got it now').",
    "- something the user already raised and resolved in the same conversation.",
    "",
    "For each reported promise output:",
    "  promise_text       — the action distilled, ≤240 chars. Verb + object, second-person-implicit relative to the promiser. Drop modals. NOT 'she said she'd send the design files'; YES 'send the design files'.",
    "  horizon_text       — the EXACT phrase indicating when. e.g. 'tomorrow', 'by friday', 'this weekend', 'next week', 'soon', 'in a bit'. Empty string if no horizon was given.",
    "  horizon_kind       — ONE of: today / tomorrow / this_week / this_weekend / next_week / this_month / next_month / soon / eventually / unspecified.",
    "  relationship_with  — THE NOVEL DIAGNOSTIC FIELD. WHO made the promise to the user? ONE of:",
    "    partner    — current romantic partner",
    "    parent     — mother, father, parental figure",
    "    sibling    — brother, sister",
    "    friend     — close friend or peer",
    "    colleague  — coworker (peer relationship — same level)",
    "    boss       — manager, employer figure (someone who has authority over the user at work)",
    "    client     — customer, paying party, business client",
    "    stranger   — someone the user doesn't know well (contractor, GP, dentist, plumber, agent, official)",
    "    unknown    — you genuinely cannot infer who",
    "  person_text        — OPTIONAL 4-160 chars. The specific person/role phrasing when nameable. e.g. 'my dad', 'Sarah from the design team', 'the contractor', 'Tom my GP', 'my landlord'. Null if not specific.",
    "  domain             — work / health / relationships / family / finance / creative / self / spiritual / other.",
    "  charge             — 1-5. How load-bearing this is on the user's life:",
    "    1 — passing low-stakes promise ('she said she'd send the playlist')",
    "    2 — minor practical promise",
    "    3 — operational dependency — the user has organised things around this",
    "    4 — significant — a meaningful chunk of the user's plans depends on this",
    "    5 — load-bearing — the user's life is materially gated on this person doing what they said",
    "  recency            — recent (mentioned recently) | older (referencing a long-standing wait).",
    "  confidence         — 1-5.",
    "  msg_id             — EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "Output strict JSON ONLY:",
    `{"owed_to_me": [{"promise_text":"...", "horizon_text":"...", "horizon_kind":"...", "relationship_with":"...", "person_text":"..."|null, "domain":"...", "charge": 1-5, "recency":"recent|older", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- promise_text: distilled, ≤240 chars. Capture the SHAPE of the promised action.",
    "- horizon_text: EXACT phrase the user used. Empty string if none.",
    "- horizon_kind: pick the closest bucket. Use 'unspecified' if genuinely no horizon stated.",
    "- relationship_with: ONE of the 9 values. Use 'unknown' if you cannot tell.",
    "- person_text: VERBATIM where possible. Null if the person isn't specific.",
    "- domain: ONE of the 9 valid domains.",
    "- charge: 1-5. Be conservative. Most reported promises are 2-3.",
    "- recency: recent | older.",
    "- confidence: 1-5.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "- DROP confidence < 2.",
    "- DROP if promise was already fulfilled in the same message.",
    "- DROP commitments the USER made — only extract what OTHERS said they'd do.",
    "- DROP vague speculation ('they'll probably', 'I hope she does').",
    "",
    "Quality over quantity. British English. No em-dashes. The relationship_with field is the most important — if you can't sense who made the promise, mark 'unknown' rather than guess.",
  ].join("\n");

  const userMsg = ["EVIDENCE:", "", lines.join("\n")].join("\n");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  const anthropic = new Anthropic({ apiKey });

  let raw = "";
  let model = MODEL;
  let switched = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: userMsg }],
      });
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no text block");
      raw = block.text.trim();
      break;
    } catch (e) {
      if (!switched && isOverloaded(e)) { switched = true; model = FALLBACK_MODEL; continue; }
      return NextResponse.json({ error: e instanceof Error ? e.message : "haiku failed" }, { status: 502 });
    }
  }

  let parsed: { owed_to_me?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.owed_to_me)) {
    return NextResponse.json({ error: "model output missing owed_to_me array" }, { status: 502 });
  }

  type ParsedP = {
    promise_text?: unknown;
    horizon_text?: unknown;
    horizon_kind?: unknown;
    relationship_with?: unknown;
    person_text?: unknown;
    domain?: unknown;
    charge?: unknown;
    recency?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidP = {
    promise_text: string;
    horizon_text: string;
    horizon_kind: string;
    relationship_with: string;
    person_text: string | null;
    domain: string;
    charge: number;
    recency: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string;
    target_date: string;
  };

  const valid: ValidP[] = [];
  const seenLocal = new Set<string>();
  for (const p of parsed.owed_to_me as ParsedP[]) {
    const text = typeof p.promise_text === "string" ? p.promise_text.trim().slice(0, 280) : "";
    const horizonText = typeof p.horizon_text === "string" ? p.horizon_text.trim().slice(0, 80) : "";
    const horizonKind = typeof p.horizon_kind === "string" && VALID_HORIZON.has(p.horizon_kind) ? p.horizon_kind : null;
    const relationship = typeof p.relationship_with === "string" && VALID_RELATIONSHIP.has(p.relationship_with) ? p.relationship_with : null;
    const personRaw = typeof p.person_text === "string" ? p.person_text.trim() : "";
    const personText = personRaw.length >= 4 ? personRaw.slice(0, 160) : null;
    const domain = typeof p.domain === "string" && VALID_DOMAIN.has(p.domain) ? p.domain : null;
    const charge = typeof p.charge === "number" ? Math.max(1, Math.min(5, Math.round(p.charge))) : 2;
    const recency = typeof p.recency === "string" && VALID_RECENCY.has(p.recency) ? p.recency : "recent";
    const confidence = typeof p.confidence === "number" ? Math.max(1, Math.min(5, Math.round(p.confidence))) : 3;
    const msgId = typeof p.msg_id === "string" ? p.msg_id.trim() : "";

    if (!horizonKind || !relationship || !domain) continue;
    if (text.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    const dedupKey = `${msgId}::${text.toLowerCase()}`;
    if (seenLocal.has(dedupKey)) continue;
    seenLocal.add(dedupKey);

    const spokenDate = msgDates.get(msgId) as string;
    const conversationId = msgConvos.get(msgId) as string;
    const targetDate = computeTargetDate(spokenDate, horizonKind);

    valid.push({
      promise_text: text,
      horizon_text: horizonText || (horizonKind === "unspecified" ? "" : horizonKind.replace(/_/g, " ")),
      horizon_kind: horizonKind,
      relationship_with: relationship,
      person_text: personText,
      domain,
      charge,
      recency,
      confidence,
      spoken_date: spokenDate,
      spoken_message_id: msgId,
      conversation_id: conversationId,
      target_date: targetDate,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying reported-promises detected", latency_ms: Date.now() - t0 });
  }

  // UPSERT-by-(user_id, spoken_message_id, promise_text). Same message
  // can contain multiple distinct promises so the dedup key includes
  // promise_text. Existing rows preserved (don't churn user-set status).
  const msgIds = Array.from(new Set(valid.map((v) => v.spoken_message_id)));
  const { data: existingRows } = await supabase
    .from("owed_to_me")
    .select("id, spoken_message_id, promise_text")
    .eq("user_id", user.id)
    .in("spoken_message_id", msgIds);
  const existingKey = new Set<string>();
  for (const r of (existingRows ?? [])) existingKey.add(`${r.spoken_message_id}::${r.promise_text}`);

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  const toInsert: Array<Record<string, unknown>> = [];
  let dedupedCount = 0;
  for (const v of valid) {
    const key = `${v.spoken_message_id}::${v.promise_text}`;
    if (existingKey.has(key)) { dedupedCount++; continue; }
    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      promise_text: v.promise_text,
      horizon_text: v.horizon_text,
      horizon_kind: v.horizon_kind,
      relationship_with: v.relationship_with,
      person_text: v.person_text,
      domain: v.domain,
      charge: v.charge,
      recency: v.recency,
      spoken_date: v.spoken_date,
      spoken_message_id: v.spoken_message_id,
      conversation_id: v.conversation_id,
      target_date: v.target_date,
      confidence: v.confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      ok: true,
      scan_id: scanId,
      inserted: 0,
      message: "all detected reported-promises already on file",
      latency_ms: latencyMs,
      signals: {
        candidate_messages: candidates.length,
        sampled: sampled.length,
        emitted: valid.length,
        deduped: dedupedCount,
      },
    });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("owed_to_me")
    .insert(toInsert)
    .select("id, scan_id, promise_text, horizon_text, horizon_kind, relationship_with, person_text, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, target_date, confidence, status, resolution_note, raised_outcome, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    owed_to_me: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      candidate_messages: candidates.length,
      sampled: sampled.length,
      emitted: valid.length,
      deduped: dedupedCount,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
