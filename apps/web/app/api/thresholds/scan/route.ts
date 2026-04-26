// POST /api/thresholds/scan — The Threshold Ledger (§169).
//
// Body: { window_days?: 30-730 (default 180) }
//
// Mines chats for moments where the user crossed an INTERNAL LINE.
// Trigger phrases: "I never thought I would", "I would never have",
// "First time I actually", "I used to think I couldn't", "Now I'm
// someone who", "Since when did I", "The old me would have", etc.
//
// One Haiku call extracts threshold crossings. For each: verbatim
// threshold_text, distilled before_state + after_state, pivot_kind,
// charge (growth/drift/mixed), magnitude 1-5, domain, crossed_recency,
// confidence, msg_id.
//
// The novel hook: charge. Naming whether the crossing was GROWTH or
// DRIFT is what turns a passing utterance into self-knowledge.
//
// Dedup by (user_id, spoken_message_id) so re-scans don't flood.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4500;

const VALID_PIVOT_KINDS = new Set([
  "capability", "belief", "boundary", "habit", "identity", "aesthetic", "relational", "material",
]);
const VALID_CHARGES = new Set(["growth", "drift", "mixed"]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);
const VALID_RECENCY = new Set(["recent", "older"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

const TRIGGER_RE = /\b(i (?:never|honestly never|genuinely never|honestly didn'?t|never thought i'?d|never thought i would|would never (?:have|in a million)|always said i (?:wouldn'?t|would never)|used to think (?:i couldn'?t|i wouldn'?t|i'?d never)|used to (?:hate|fear|avoid|run from|swear|believe)|wouldn'?t have (?:dreamt|dreamed|imagined|believed))|first time i (?:actually|ever|properly|really)|now i'?m someone who|now i'?m a person who|now i (?:can|do|will|actually)|since when (?:do|did) i|the (?:old|past|former|previous) me|past me would|past me wouldn'?t|old me would|old me wouldn'?t|i can'?t believe i (?:actually|just|finally)|i never (?:would have|thought i'?d)|i'?d never have (?:done|said|tried|gone|been|made|chosen|picked)|i used to (?:think|believe|swear|say|tell myself|hate|fear|avoid))\b/i;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(30, Math.min(730, Math.round(body.window_days ?? 180)));

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

  if (userMessages.length < 20) {
    return NextResponse.json({ error: "not enough chat history in this window — try a longer window" }, { status: 400 });
  }

  const candidates = userMessages.filter((m) =>
    TRIGGER_RE.test(m.content) &&
    m.content.length >= 20 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no threshold crossings detected in this window", latency_ms: Date.now() - t0 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 400 ? m.content.slice(0, 360) + " ..." : m.content,
  }));

  const SAMPLE_LIMIT = 120;
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
  lines.push(`THRESHOLD CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting THRESHOLD CROSSINGS — moments where the user typed something that names crossing an INTERNAL LINE. The user is noticing that present-self has done something past-self would not have. Trigger forms: 'I never thought I would', 'I would never have', 'First time I actually', 'I used to think I couldn't', 'Now I'm someone who', 'Since when did I', 'The old me would have', 'I can't believe I just', 'I'd never have done X but I did'.",
    "",
    "Each threshold has TWO sides — a BEFORE state (what past-self was/believed/feared) and an AFTER state (what's true now). Capture both, distilled tightly.",
    "",
    "The novel signal you must capture: CHARGE — was this crossing GROWTH (a line crossed in the direction the user wanted, evidence of becoming) or DRIFT (a line crossed without consent, a worrying compromise, evidence of slippage)? Read the surrounding tone and body of the message. A crossing said with relief or pride is growth. A crossing said with shame, surprise without joy, or 'how did I get here' tone is drift. If genuinely both, mixed.",
    "",
    "Eight pivot kinds. Pick the BEST fit:",
    "  capability   — something the user couldn't or didn't do, now can or does. 'first time I actually finished a 10k', 'I never thought I'd run my own thing'.",
    "  belief       — a previously held conviction now reversed. 'I used to think therapy was for other people', 'I always said money doesn't matter to me'.",
    "  boundary     — a line in how the user lets others treat them or how they treat themselves. 'I would never have said no to my dad before', 'I actually walked out of the meeting'.",
    "  habit        — a recurring behaviour (started or stopped). 'I used to drink every night and now I don't', 'since when do I go to bed at 10'.",
    "  identity     — a 'kind of person' shift. 'now I'm someone who', 'I used to be a London person and now I'm not'.",
    "  aesthetic    — taste, style, what they enjoy. 'I never thought I'd like classical music', 'I used to hate beige and now my whole flat is beige'.",
    "  relational   — a shift in how the user shows up in relationships. 'I never thought I'd be the one calling my mum', 'I'd never have apologised first before'.",
    "  material     — money, possessions, lifestyle. 'I never thought I'd spend £200 on dinner', 'I used to buy everything new'.",
    "",
    "Three charges:",
    "  growth — the user is naming a positive crossing. Tone: pride, relief, surprise-but-good, ownership.",
    "  drift  — the user is naming a worrying crossing. Tone: shame, dismay, 'how did I get here', surprise-but-bad, alarm. CRITICAL: the same surface phrase 'I never thought I would' can mean either. Read the tone.",
    "  mixed  — the crossing has both flavours. Don't default to mixed for safety — pick growth or drift if either is clearly dominant.",
    "",
    "Five magnitudes:",
    "  1 — tiny adjustment. ('I never thought I'd order from that place again.')",
    "  2 — noticeable shift but small. ('First time I actually went to bed before 11.')",
    "  3 — clearly meaningful. ('I never thought I'd say no to that meeting.')",
    "  4 — substantial pivot. ('I never thought I'd quit my job.')",
    "  5 — fundamental identity shift. ('I never thought I'd live alone and prefer it.', 'first time I actually feel like a different person.')",
    "",
    "Crossed recency:",
    "  recent — the crossing happened during or just before the window the user is reflecting on. The threshold is fresh.",
    "  older  — the user is reflecting on a crossing that happened years ago, just naming it now ('I used to think I couldn't write a book' said by someone who already wrote one).",
    "",
    "Output strict JSON ONLY:",
    `{"thresholds": [{"threshold_text":"...", "before_state":"...", "after_state":"...", "pivot_kind":"...", "charge":"...", "magnitude": 1-5, "domain":"...", "crossed_recency":"recent|older", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- threshold_text: VERBATIM utterance, ≤180 chars. The actual phrase the user typed.",
    "- before_state: distilled past-self description. ≤200 chars. Speak in second person ('you used to'). Examples: 'you used to think therapy was indulgent', 'you were someone who couldn't say no to your dad', 'you couldn't picture yourself running your own thing'.",
    "- after_state: distilled present-self description. ≤200 chars. Second person ('you'). Examples: 'you book sessions, you talk about feelings, you defend the practice', 'you said no twice this week', 'you're four months in and still going'.",
    "- pivot_kind: ONE of capability/belief/boundary/habit/identity/aesthetic/relational/material.",
    "- charge: growth | drift | mixed.",
    "- magnitude: 1-5 by the size of the crossing.",
    "- domain: ONE of work/relationships/health/identity/finance/creative/learning/daily/other.",
    "- crossed_recency: recent if the crossing happened in or near the window, older if the user is reflecting on a long-past crossing.",
    "- confidence: 1-5.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "DO NOT extract:",
    "- Hypothetical futures ('I'll never give up my flat'). Crossings are about what HAS happened.",
    "- Past regrets phrased as 'I should never have' (those are §166 shoulds, not thresholds).",
    "- Generic past-tense narration without an internal-line marker ('I went to the gym yesterday').",
    "- Same crossing twice across nearby messages — pick the cleanest occurrence.",
    "",
    "British English. No em-dashes. Don't invent crossings that aren't in the messages. Quality over quantity. If borderline, emit with confidence=2 so the user can see it.",
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

  let parsed: { thresholds?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.thresholds)) {
    return NextResponse.json({ error: "model output missing thresholds array" }, { status: 502 });
  }

  type ParsedT = {
    threshold_text?: unknown;
    before_state?: unknown;
    after_state?: unknown;
    pivot_kind?: unknown;
    charge?: unknown;
    magnitude?: unknown;
    domain?: unknown;
    crossed_recency?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidT = {
    threshold_text: string;
    before_state: string;
    after_state: string;
    pivot_kind: string;
    charge: string;
    magnitude: number;
    domain: string;
    crossed_recency: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string | null;
  };

  const valid: ValidT[] = [];
  for (const t of parsed.thresholds as ParsedT[]) {
    const text = typeof t.threshold_text === "string" ? t.threshold_text.trim().slice(0, 220) : "";
    const before = typeof t.before_state === "string" ? t.before_state.trim().slice(0, 240) : "";
    const after = typeof t.after_state === "string" ? t.after_state.trim().slice(0, 240) : "";
    const pivotKind = typeof t.pivot_kind === "string" && VALID_PIVOT_KINDS.has(t.pivot_kind) ? t.pivot_kind : null;
    const charge = typeof t.charge === "string" && VALID_CHARGES.has(t.charge) ? t.charge : null;
    const magnitude = typeof t.magnitude === "number" ? Math.max(1, Math.min(5, Math.round(t.magnitude))) : 2;
    const domain = typeof t.domain === "string" && VALID_DOMAINS.has(t.domain) ? t.domain : null;
    const recency = typeof t.crossed_recency === "string" && VALID_RECENCY.has(t.crossed_recency) ? t.crossed_recency : "recent";
    const confidence = typeof t.confidence === "number" ? Math.max(1, Math.min(5, Math.round(t.confidence))) : 3;
    const msgId = typeof t.msg_id === "string" ? t.msg_id.trim() : "";

    if (!pivotKind || !charge || !domain) continue;
    if (text.length < 4 || before.length < 4 || after.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      threshold_text: text,
      before_state: before,
      after_state: after,
      pivot_kind: pivotKind,
      charge,
      magnitude,
      domain,
      crossed_recency: recency,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying thresholds detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 730 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("thresholds")
    .select("spoken_message_id")
    .eq("user_id", user.id)
    .gte("created_at", yearAgoIso);
  const existingMsgIds = new Set(
    ((existingRows ?? []) as Array<{ spoken_message_id: string | null }>)
      .map((r) => r.spoken_message_id)
      .filter((s): s is string => typeof s === "string"),
  );

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  const toInsert = valid
    .filter((v) => !existingMsgIds.has(v.spoken_message_id))
    .map((v) => ({
      user_id: user.id,
      scan_id: scanId,
      threshold_text: v.threshold_text,
      before_state: v.before_state,
      after_state: v.after_state,
      pivot_kind: v.pivot_kind,
      charge: v.charge,
      magnitude: v.magnitude,
      domain: v.domain,
      crossed_recency: v.crossed_recency,
      confidence: v.confidence,
      spoken_date: v.spoken_date,
      spoken_message_id: v.spoken_message_id,
      conversation_id: v.conversation_id,
      latency_ms: latencyMs,
      model,
    }));

  if (toInsert.length === 0) {
    return NextResponse.json({
      ok: true,
      scan_id: scanId,
      inserted: 0,
      message: "all detected thresholds already on file",
      latency_ms: latencyMs,
      signals: {
        candidate_messages: candidates.length,
        sampled: sampled.length,
        emitted: valid.length,
        deduped: valid.length,
      },
    });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("thresholds")
    .insert(toInsert)
    .select("id, scan_id, threshold_text, before_state, after_state, pivot_kind, charge, magnitude, domain, crossed_recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    thresholds: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      candidate_messages: candidates.length,
      sampled: sampled.length,
      emitted: valid.length,
      deduped: valid.length - toInsert.length,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
