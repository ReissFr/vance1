// POST /api/promises/scan — mine the user's chat history for SELF-PROMISES.
//
// Body: { window_days?: 14-365 (default 120) }
//
// Self-promises are sentences where the user commits to themselves to do
// something specific: "I will run tomorrow", "next week I'll cut the agency",
// "starting Monday I'm going to write daily", "I need to stop drinking on
// weekdays". This is the inverse of a TODO list — a record of commitments
// the user already made, surfaced so they can see their own pattern.
//
// Each promise is one row. We compute repeat_count by clustering similar
// action_summaries against existing promises so re-promises are highlighted.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 3200;

const VALID_CATEGORIES = new Set([
  "habit", "decision", "relationship", "health", "work",
  "creative", "financial", "identity", "other",
]);

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "at", "by",
  "with", "is", "are", "was", "were", "be", "been", "being", "this", "that",
  "these", "those", "it", "i", "my", "me", "we", "our", "us", "you", "your",
  "from", "as", "but", "not", "no", "if", "so",
]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  const lower = s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  for (const w of lower.split(/\s+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// Resolve a relative deadline_text (e.g. "tomorrow", "next week", "in 3 days",
// "starting Monday", "by end of month") against the date the promise was made.
// Returns YYYY-MM-DD or null. Errs on the side of NULL — only handles
// unambiguous cases.
function resolveDeadline(deadlineText: string | null, promisedAt: string): string | null {
  if (!deadlineText) return null;
  const t = deadlineText.toLowerCase().trim();
  if (!t || t === "open" || t === "open-ended" || t === "someday") return null;
  const base = new Date(promisedAt + "T12:00:00.000Z");
  if (isNaN(base.getTime())) return null;
  const add = (days: number) => {
    const d = new Date(base.getTime() + days * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  if (/\btoday\b/.test(t)) return add(0);
  if (/\btomorrow\b/.test(t)) return add(1);
  if (/\bday after tomorrow\b/.test(t)) return add(2);
  if (/\bthis week\b/.test(t)) return add(7);
  if (/\bnext week\b/.test(t)) return add(14);
  if (/\bthis month\b/.test(t) || /\bend of (the )?month\b/.test(t)) {
    const d = new Date(base);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  }
  if (/\bnext month\b/.test(t)) return add(30);
  if (/\bnext year\b/.test(t)) return add(365);
  if (/\bend of (the )?year\b/.test(t)) {
    const d = new Date(base);
    return `${d.getUTCFullYear()}-12-31`;
  }
  const inDaysM = t.match(/\bin (\d+)\s*days?\b/);
  if (inDaysM && inDaysM[1]) return add(parseInt(inDaysM[1], 10));
  const inWeeksM = t.match(/\bin (\d+)\s*weeks?\b/);
  if (inWeeksM && inWeeksM[1]) return add(parseInt(inWeeksM[1], 10) * 7);
  const inMonthsM = t.match(/\bin (\d+)\s*months?\b/);
  if (inMonthsM && inMonthsM[1]) {
    const d = new Date(base);
    d.setUTCMonth(d.getUTCMonth() + parseInt(inMonthsM[1], 10));
    return d.toISOString().slice(0, 10);
  }
  const isoM = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoM && isoM[1]) return isoM[1];
  return null;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(14, Math.min(365, Math.round(body.window_days ?? 120)));

  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const todayDate = dateOnly(new Date().toISOString());
  const startDate = dateOnly(startIso);

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at")
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", startIso)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  const messages = (msgRows ?? []) as Array<{ id: string; conversation_id: string; content: string; created_at: string }>;

  if (messages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in the window — try a longer window or come back after more conversations" }, { status: 400 });
  }

  // Filter to messages that contain commitment-language markers — the model
  // doesn't need to read every message, just the candidates.
  const COMMIT_RE = /\b(i will|i'?ll|i am going to|i'?m going to|i'?m gonna|i need to|i have to|i must|i should|starting (tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)|next week i|next month i|tomorrow i|by (tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|end of)|from now on|never again|no more|i promise|i commit)/i;
  const candidates = messages.filter((m) => COMMIT_RE.test(m.content));

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no commitment-language sentences found in this window", latency_ms: Date.now() - t0 });
  }

  // Trim candidates to manageable size. Keep first 320 chars (commitments
  // tend to land near the start of a paragraph).
  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 320 ? m.content.slice(0, 280) + " ..." : m.content,
  }));

  // Sample if too many
  const SAMPLE_LIMIT = 240;
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

  // Build a map from message id to date for backreference validation
  const msgDates = new Map<string, string>();
  const msgConvos = new Map<string, string>();
  for (const m of sampled) {
    msgDates.set(m.id, dateOnly(m.created_at));
    msgConvos.set(m.id, m.conversation_id);
  }

  const lines: string[] = [];
  lines.push(`WINDOW: ${startDate} → ${todayDate} (${windowDays} days)`);
  lines.push(`COMMITMENT-CANDIDATE MESSAGES: ${sampled.length} (filtered to messages containing commitment language)`);
  lines.push("");
  lines.push("CANDIDATE MESSAGES (chronological — each line tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting SELF-PROMISES from the user's own messages. A self-promise is a sentence where the user commits TO THEMSELVES to do (or stop doing) something specific. Linguistic markers: 'I will X', 'I'm going to X', 'I'll start X', 'starting Monday I'll Y', 'next week I'll Z', 'I need to X' (with commitment force, not just observation), 'no more X', 'from now on I X', 'I promise myself X'.",
    "",
    "Output strict JSON ONLY:",
    `{"promises": [{"action_summary":"...", "original_quote":"...", "category":"...", "deadline_text":"...", "promised_at_msg_id":"...", "strength":1-5}, ...]}`,
    "",
    "Rules:",
    "- Each promise is ONE discrete commitment. If the user said 'I'll run tomorrow and start writing on Monday', that's TWO promises.",
    "- action_summary: 3-8 words distilling the action ('Run tomorrow', 'Cut the agency project', 'Stop drinking on weekdays'). Imperative-style, no 'I'.",
    "- original_quote: the verbatim sentence (or sentence fragment) from the user's message containing the commitment. Cap 240 chars. Don't paraphrase.",
    "- category: one of habit | decision | relationship | health | work | creative | financial | identity | other.",
    "- deadline_text: the deadline as the user spoke it: 'tomorrow', 'next week', 'starting Monday', 'by end of month', 'in 3 months', '2026-05-01', or 'open' if no deadline.",
    "- promised_at_msg_id: the msg_id from the [date|msg_id|conv:...] tag of the message this promise came from. EXACT string match — copy from the tag.",
    "- strength: 1-5 commitment force. 5 = 'I am doing this, this is decided' / 'I will' / 'starting Monday'; 4 = strong; 3 = clear intent; 2 = soft ('I should probably'); 1 = casual mention. Be honest — language matters.",
    "",
    "DO NOT extract:",
    "- Questions ('should I X?') — those aren't promises",
    "- Observations ('I am tired', 'I have been working hard') — those aren't promises",
    "- Hypotheticals ('if I had more time I would X')",
    "- Promises to OTHERS ('I'll text Sarah tomorrow' — only if it's a self-promise about a behaviour, e.g. 'I'll start texting Sarah weekly')",
    "- The same promise extracted twice from the same message",
    "- Casual asides without commitment force",
    "",
    "DO extract even soft promises ('I should probably eat better') — flag them with low strength (1-2). The user wants to see their full ledger, including the half-hearted commitments.",
    "",
    "If a message contains multiple promises, return all of them as separate entries. If a message contains no real promises despite having commitment-language, skip it entirely.",
    "",
    "Voice: British English, no em-dashes, no clichés. action_summary should be sharp and concrete.",
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

  let parsed: { promises?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.promises)) {
    return NextResponse.json({ error: "model output missing promises array" }, { status: 502 });
  }

  // Pull existing promises (last year) for repeat_count + dedup-by-message
  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("promises")
    .select("id, action_summary, source_message_id, promised_at, created_at")
    .eq("user_id", user.id)
    .gte("created_at", yearAgoIso);
  const existing = (existingRows ?? []) as Array<{ id: string; action_summary: string; source_message_id: string | null; promised_at: string; created_at: string }>;
  const existingMsgIds = new Set(existing.filter((e) => e.source_message_id).map((e) => e.source_message_id as string));
  const existingTokens = existing.map((e) => ({ id: e.id, tokens: tokens(e.action_summary), promised_at: e.promised_at }));

  type Parsed = {
    action_summary?: unknown;
    original_quote?: unknown;
    category?: unknown;
    deadline_text?: unknown;
    promised_at_msg_id?: unknown;
    strength?: unknown;
  };

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  type Insert = {
    user_id: string;
    scan_id: string;
    action_summary: string;
    original_quote: string;
    category: string;
    deadline_text: string | null;
    deadline_date: string | null;
    promised_at: string;
    source_conversation_id: string | null;
    source_message_id: string | null;
    strength: number;
    repeat_count: number;
    prior_promise_id: string | null;
    latency_ms: number;
    model: string;
  };
  const toInsert: Insert[] = [];
  // Track this scan's own action_summaries so we can compute cross-scan repeat too
  const thisScanTokens: Array<{ tokens: Set<string>; idx: number; promised_at: string }> = [];

  for (const p of parsed.promises as Parsed[]) {
    const action = typeof p.action_summary === "string" ? p.action_summary.trim().slice(0, 200) : "";
    const quote = typeof p.original_quote === "string" ? p.original_quote.trim().slice(0, 320) : "";
    const category = typeof p.category === "string" && VALID_CATEGORIES.has(p.category) ? p.category : null;
    const dlText = typeof p.deadline_text === "string" && p.deadline_text.trim() ? p.deadline_text.trim().toLowerCase().slice(0, 80) : null;
    const msgId = typeof p.promised_at_msg_id === "string" ? p.promised_at_msg_id.trim() : "";
    const strength = typeof p.strength === "number" ? Math.max(1, Math.min(5, Math.round(p.strength))) : null;

    if (!category || !strength) continue;
    if (action.length < 4 || quote.length < 8) continue;
    if (!msgId || !msgDates.has(msgId)) continue; // model must reference a real message

    // Skip if we already have a promise from this exact message with the same action
    if (existingMsgIds.has(msgId)) {
      // Need to also check action similarity; we'll let dedup handle it via repeat_count instead
    }

    const promisedAt = msgDates.get(msgId) as string;
    const conversationId = msgConvos.get(msgId) ?? null;
    const deadlineDate = resolveDeadline(dlText, promisedAt);
    const dlNormalised = dlText && dlText !== "open" && dlText !== "" ? dlText : null;

    // Compute repeat_count: count of prior similar action_summaries (Jaccard ≥ 0.5)
    // by promised_at < this promise's promised_at.
    const tk = tokens(action);
    let repeatCount = 0;
    let priorId: string | null = null;
    let priorDate = "";
    for (const ex of existingTokens) {
      if (ex.promised_at >= promisedAt) continue;
      if (jaccard(tk, ex.tokens) >= 0.5) {
        repeatCount += 1;
        if (ex.promised_at > priorDate) {
          priorDate = ex.promised_at;
          priorId = ex.id;
        }
      }
    }
    // Also count this-scan promises that are earlier
    for (const ts of thisScanTokens) {
      const tsDate = ts.promised_at;
      if (tsDate >= promisedAt) continue;
      if (jaccard(tk, ts.tokens) >= 0.5) repeatCount += 1;
    }

    thisScanTokens.push({ tokens: tk, idx: toInsert.length, promised_at: promisedAt });

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      action_summary: action,
      original_quote: quote,
      category,
      deadline_text: dlNormalised,
      deadline_date: deadlineDate,
      promised_at: promisedAt,
      source_conversation_id: conversationId,
      source_message_id: msgId,
      strength,
      repeat_count: repeatCount,
      prior_promise_id: priorId,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no qualifying self-promises detected in this scan", latency_ms: latencyMs });
  }

  // Skip duplicates from same message + similar action that already exist
  const filteredInserts: Insert[] = [];
  for (const ins of toInsert) {
    if (ins.source_message_id && existingMsgIds.has(ins.source_message_id)) {
      // Check if a prior promise with high token overlap from the same message exists
      const dup = existing.find((e) => e.source_message_id === ins.source_message_id && jaccard(tokens(ins.action_summary), tokens(e.action_summary)) >= 0.6);
      if (dup) continue;
    }
    filteredInserts.push(ins);
  }

  if (filteredInserts.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "all detected promises were already in the ledger", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("promises")
    .insert(filteredInserts)
    .select("id, scan_id, action_summary, original_quote, category, deadline_text, deadline_date, promised_at, source_conversation_id, source_message_id, strength, repeat_count, prior_promise_id, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    promises: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: messages.length,
      candidate_messages: candidates.length,
      sampled: sampled.length,
    },
  });
}
