// POST /api/conversation-loops/scan — mine the user's chat history with JARVIS
// for recurring question/topic threads they keep circling.
//
// Body: { window_days?: 14-180 (default 60), min_occurrences?: 3-20 (default 4) }
//
// Pulls user-role messages from the conversations table over the window,
// clusters them by topic+question-shape, and asks Haiku to identify 0-6
// recurring loops. Each loop has a label, recurring question, sample quotes,
// span, and optional candidate exit path.
//
// Dedups against existing OPEN loops by lowercased loop_label (so re-running
// doesn't flood the user with duplicates).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2400;

const VALID_DOMAINS = new Set(["energy", "mood", "focus", "time", "decisions", "relationships", "work", "identity", "money", "mixed"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number; min_occurrences?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(14, Math.min(180, Math.round(body.window_days ?? 60)));
  const minOccurrences = Math.max(3, Math.min(20, Math.round(body.min_occurrences ?? 4)));

  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const todayDate = dateOnly(new Date().toISOString());
  const startDate = dateOnly(startIso);

  // Pull user-role messages
  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("conversation_id, content, created_at")
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", startIso)
    .order("created_at", { ascending: false })
    .limit(800);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  const messages = (msgRows ?? []) as Array<{ conversation_id: string; content: string; created_at: string }>;

  if (messages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in the window — try a longer window or come back after more conversations" }, { status: 400 });
  }

  // Trim each message to a manageable size (keep the first 240 chars, which
  // is where the question usually is, plus a tail)
  const trimmed = messages.map((m) => ({
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 280 ? m.content.slice(0, 240) + " ..." : m.content,
  }));

  // Compute baseline counts: distinct conversations, distinct days, total messages.
  const distinctConvos = new Set(messages.map((m) => m.conversation_id)).size;
  const distinctDays = new Set(messages.map((m) => dateOnly(m.created_at))).size;

  // Build evidence dump. Group messages chronologically. For larger histories
  // we sample evenly across the window so the model can see the time dimension.
  const SAMPLE_LIMIT = 220;
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
  // Sort sampled chronologically (oldest first) so the model sees the arc.
  sampled.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const lines: string[] = [];
  lines.push(`WINDOW: ${startDate} → ${todayDate} (${windowDays} days)`);
  lines.push(`COUNTS: ${messages.length} user messages across ${distinctConvos} conversations on ${distinctDays} distinct days`);
  lines.push(`MIN OCCURRENCE THRESHOLD: ${minOccurrences} (don't surface a loop unless it appears in at least ${minOccurrences} distinct conversations)`);
  lines.push("");
  lines.push(`USER MESSAGES (chronological, sampled to ${sampled.length}):`);
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are detecting CONVERSATION LOOPS — recurring question/topic threads the user keeps raising across multiple conversations without resolving. The user is talking to you (the JARVIS assistant) and circles certain questions for weeks or months without seeing it. Your job is to NAME the loops.",
    "",
    "Output strict JSON ONLY:",
    `{"loops": [{"loop_label": "...", "recurring_question": "...", "pattern_summary": "...", "domain": "...", "occurrence_count": N, "span_days": N, "first_seen": "YYYY-MM-DD", "last_seen": "YYYY-MM-DD", "sample_quotes": [{"date":"YYYY-MM-DD","snippet":"...","conversation_id_prefix":"xxxxxxxx"}], "candidate_exit": "...", "strength": 1-5}, ...]}`,
    "",
    "Rules:",
    "- Return 0-6 loops. ZERO is fine. Don't pad. A loop must appear in at least the MIN OCCURRENCE THRESHOLD of distinct conversations.",
    "- loop_label: 3-8 words, headline-cased. Captures the question/topic SHAPE, not the surface wording (e.g. 'Should I keep the agency project', 'Am I a builder or operator', 'Is the WhatsApp-first approach right').",
    "- recurring_question: ONE sentence in the user's own voice (lifted or tightly paraphrased from their messages) that stands in for the recurring question.",
    "- pattern_summary: 2-3 sentences naming the loop pattern. If there's an OSCILLATION (the user goes back and forth between positions A and B), name it. If the loop is stuck in a question without ever committing to an answer, name that. If the loop deepens without resolution, name that. SECOND-PERSON voice, no hedging.",
    "- domain: one of energy | mood | focus | time | decisions | relationships | work | identity | money | mixed.",
    "- occurrence_count: integer count of DISTINCT conversations (not messages) the loop appeared in. Must be ≥ MIN OCCURRENCE THRESHOLD.",
    "- span_days: integer count of distinct calendar days the loop appeared on.",
    "- first_seen / last_seen: ISO YYYY-MM-DD dates pulled from the messages.",
    "- sample_quotes: 2-5 dated quotes from the user's own messages — pick representative or pivot moments. Each must include date, snippet (≤200 chars from user's message), and conversation_id_prefix (first 8 chars of the conversation_id).",
    "- candidate_exit: ONE optional second-person sentence framing an ACTIONABLE next step OUT of the loop. e.g. 'Run a counter-self chamber against the position you keep returning to.', 'Set a 14-day decision deadline and log it as a decision so the loop has to close.', 'Ask yourself: what would have to be true for this question to disappear?'. NOT advice. NULL if no clean exit.",
    "- strength: 1-5. 5 = ironclad load-bearing loop (≥10 occurrences AND ≥4 weeks span AND clearly central to the user's recent thinking); 4 = strong; 3 = noticeable; 2 = weak; 1 = noise-floor curiosity.",
    "",
    "DO NOT surface single-conversation rambles — only loops that span MULTIPLE conversations.",
    "DO NOT surface short recent threads (< minOccurrences distinct conversations).",
    "DO NOT moralise. The user can decide if a loop is worth resolving — your job is to NAME, not judge.",
    "DO NOT invent quotes. Pull from the USER MESSAGES block above. Each sample_quote.snippet must be ≤200 chars from a real message you can see.",
    "DO NOT fabricate dates. Use dates that appear in the data.",
    "",
    "Voice: British English, no em-dashes, no hedging, no clichés, no advice. Loops are observations, not lessons.",
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

  let parsed: { loops?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.loops)) {
    return NextResponse.json({ error: "model output missing loops array" }, { status: 502 });
  }

  // Pull existing OPEN loops for dedup
  const { data: existingOpen } = await supabase
    .from("conversation_loops")
    .select("loop_label")
    .eq("user_id", user.id)
    .is("user_status", null)
    .is("archived_at", null);
  const existingSet = new Set((existingOpen ?? []).map((r) => ((r as { loop_label: string }).loop_label ?? "").toLowerCase().trim()));

  type Parsed = {
    loop_label?: unknown;
    recurring_question?: unknown;
    pattern_summary?: unknown;
    domain?: unknown;
    occurrence_count?: unknown;
    span_days?: unknown;
    first_seen?: unknown;
    last_seen?: unknown;
    sample_quotes?: unknown;
    candidate_exit?: unknown;
    strength?: unknown;
  };

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  type Insert = {
    user_id: string;
    scan_id: string;
    loop_label: string;
    recurring_question: string;
    pattern_summary: string;
    domain: string;
    occurrence_count: number;
    span_days: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
    sample_quotes: Array<{ date: string; snippet: string; conversation_id_prefix: string }>;
    candidate_exit: string | null;
    strength: number;
    latency_ms: number;
    model: string;
  };
  const toInsert: Insert[] = [];

  for (const c of parsed.loops as Parsed[]) {
    const label = typeof c.loop_label === "string" ? c.loop_label.trim().slice(0, 120) : "";
    const question = typeof c.recurring_question === "string" ? c.recurring_question.trim().slice(0, 400) : "";
    const pattern = typeof c.pattern_summary === "string" ? c.pattern_summary.trim().slice(0, 800) : "";
    const domain = typeof c.domain === "string" && VALID_DOMAINS.has(c.domain) ? c.domain : null;
    const occ = typeof c.occurrence_count === "number" ? Math.max(0, Math.round(c.occurrence_count)) : null;
    const span = typeof c.span_days === "number" ? Math.max(0, Math.round(c.span_days)) : null;
    const firstIso = typeof c.first_seen === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.first_seen) ? c.first_seen + "T00:00:00.000Z" : null;
    const lastIso = typeof c.last_seen === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.last_seen) ? c.last_seen + "T23:59:59.000Z" : null;
    const exit = typeof c.candidate_exit === "string" && c.candidate_exit.trim() ? c.candidate_exit.trim().slice(0, 400) : null;
    const strength = typeof c.strength === "number" ? Math.max(1, Math.min(5, Math.round(c.strength))) : null;

    if (!domain || !strength) continue;
    if (label.length < 4 || question.length < 8 || pattern.length < 20) continue;
    if (occ == null || occ < minOccurrences) continue;
    if (span == null) continue;

    const dedupKey = label.toLowerCase().trim();
    if (existingSet.has(dedupKey)) continue;
    existingSet.add(dedupKey);

    const quotes: Array<{ date: string; snippet: string; conversation_id_prefix: string }> = [];
    if (Array.isArray(c.sample_quotes)) {
      for (const q of c.sample_quotes) {
        if (typeof q !== "object" || !q) continue;
        const obj = q as { date?: unknown; snippet?: unknown; conversation_id_prefix?: unknown };
        const date = typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? obj.date : null;
        const snippet = typeof obj.snippet === "string" ? obj.snippet.trim().slice(0, 240) : "";
        const cid = typeof obj.conversation_id_prefix === "string" ? obj.conversation_id_prefix.trim().slice(0, 12) : "";
        if (!date || snippet.length < 4) continue;
        quotes.push({ date, snippet, conversation_id_prefix: cid });
        if (quotes.length >= 5) break;
      }
    }

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      loop_label: label,
      recurring_question: question,
      pattern_summary: pattern,
      domain,
      occurrence_count: occ,
      span_days: span,
      first_seen_at: firstIso,
      last_seen_at: lastIso,
      sample_quotes: quotes,
      candidate_exit: exit,
      strength,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new conversation loops detected this scan", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("conversation_loops")
    .insert(toInsert)
    .select("id, scan_id, loop_label, recurring_question, pattern_summary, domain, occurrence_count, span_days, first_seen_at, last_seen_at, sample_quotes, candidate_exit, strength, user_status, user_note, resolution_text, pinned, archived_at, resolved_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    conversation_loops: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_user_messages: messages.length,
      distinct_conversations: distinctConvos,
      distinct_days: distinctDays,
    },
  });
}
