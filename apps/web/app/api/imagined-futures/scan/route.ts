// POST /api/imagined-futures/scan — The Imagined-Future Register (§171).
//
// Body: { window_days?: 30-730 (default 180) }
//
// Mirror of §170 almosts but pointed forward, not back. Mines for futures
// the user has been VISITING mentally — entertained, dreamed about,
// kept coming back to.
//
// Trigger phrases: "I keep thinking about", "I keep imagining", "I find
// myself wondering", "I picture", "I daydream about", "what if I",
// "I keep coming back to the idea of", "in another life I'd",
// "sometimes I imagine", "I've been fantasising about", "I think about
// it often", "the version of me who", "I dream about", "I can see
// myself", "imagine if I", "I sometimes wonder if I should".
//
// One Haiku call extracts imagined futures. For each: verbatim
// act_text, distilled future_state (what the imagined life looks like),
// pull_kind (the diagnostic), domain, weight 1-5, recency, confidence.
//
// The novel hook: pull_kind. Seeking / escaping / grieving / entertaining.
// Same imagined future can be any of the four — read the surrounding
// tone to tell which.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4500;

const VALID_PULL_KINDS = new Set(["seeking", "escaping", "grieving", "entertaining"]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other",
]);
const VALID_RECENCY = new Set(["recent", "older"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

const TRIGGER_RE = /\b(i (?:keep|can'?t stop) (?:thinking about|imagining|wondering|coming back to|picturing|dreaming about|fantasising about|fantasizing about)|i find myself (?:thinking|imagining|wondering|wanting|wishing|picturing|dreaming)|i (?:picture|imagine|envision|see) myself|i (?:daydream|dream) about|i'?ve been (?:thinking|imagining|wondering|fantasising|fantasizing|picturing|dreaming) about|what if i (?:just|actually|really)|in another life|i (?:sometimes|often) (?:wonder|imagine|think|wish) if i (?:could|should|would)|sometimes i (?:imagine|wonder|think|wish)|the version of me who|i (?:can|could) see myself|imagine if i|maybe one day i|i'?d love to one day|one day i'?ll|in five years (?:i'?d|i would)|when i'?m (?:older|done|free)|if i ever)\b/i;

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
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no imagined futures detected in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`IMAGINED-FUTURE CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting IMAGINED FUTURES — moments where the user typed something that names a future they have been VISITING MENTALLY. The user is entertaining, dreaming about, picturing, or keep coming back to a future life or self.",
    "",
    "Trigger forms: 'I keep thinking about', 'I keep imagining', 'I find myself wondering', 'I picture myself', 'I daydream about', 'what if I just', 'I keep coming back to the idea of', 'in another life I'd', 'sometimes I imagine', 'I've been fantasising about', 'the version of me who', 'I dream about', 'I can see myself', 'imagine if I', 'maybe one day I', 'when I'm older'.",
    "",
    "Each imagined future has TWO pieces:",
    "  act_text     — VERBATIM phrase. ≤180 chars.",
    "  future_state — distilled. What the imagined life LOOKS LIKE. Second person. ≤300 chars. Examples: 'you living alone in Lisbon, working remote, swimming every morning, no commute', 'you a parent, weekends at the park, less hustle', 'you having quit corporate, freelancing, time-rich and money-tight'.",
    "",
    "The novel signal you must capture: PULL_KIND. Read the surrounding tone:",
    "",
    "  seeking      — a GENUINE PULL. The future is asking to be made real. The user keeps coming back because they actually want this. Tone: longing with energy, planning-adjacent specificity, 'I really do want this', drift toward making it concrete. The imagining feels like it's reaching for something.",
    "",
    "  escaping     — a PRESSURE-RELEASE VALVE. The imagining is doing the work. It's a way of coping with current reality, not a real plan. Tone: surfaces under stress, daydreamy quality, vagueness when probed, the user IS NOT moving toward making it real. CRITICAL: the imagining itself is the function. Naming this is the move — the user often confuses 'I keep thinking about it' with 'I want this'. They don't. They want OUT of the current thing.",
    "",
    "  grieving     — MOURNING A PATH ALREADY CLOSED. The future is no longer available (timing, age, choices made, doors shut). The imagining is grief work, not planning work. Tone: 'in another life', 'I had my chance', wistful past-conditional ('I would have'), specific details that betray it's already gone.",
    "",
    "  entertaining — IDLE CURIOSITY. No real weight. The user is just briefly wondering. Tone: light, amused, 'wouldn't that be funny', no recurrence, no charge. Don't default to entertaining for safety — pick one of the loaded kinds if either is clearly dominant.",
    "",
    "If genuinely ambiguous, prefer seeking or escaping (the loaded kinds) — those are what the user benefits most from naming. Don't hedge into entertaining unless the imagining is genuinely light.",
    "",
    "Five weights (how heavy / vivid the imagining is):",
    "  1 — fleeting mention. Once. Light. ('I sometimes wonder if I should learn ceramics.')",
    "  2 — recurring but light. ('I keep thinking I'd love to live by the sea one day.')",
    "  3 — actively returning. ('I've been imagining quitting and freelancing for months. I keep doing the maths.')",
    "  4 — vivid. The user can SEE it. Specific details. ('I picture the flat in Lisbon. I know which neighbourhood.')",
    "  5 — searing. The future feels almost more real than current life. The user catches themselves living in it. ('I'm having whole conversations in my head with the version of me who already moved.')",
    "",
    "Recency:",
    "  recent — the imagining surfaced in or near the window of reflection.",
    "  older  — the user is recalling a past period of imagining ('I used to picture moving to NYC for years').",
    "",
    "Output strict JSON ONLY:",
    `{"imagined_futures": [{"act_text":"...", "future_state":"...", "pull_kind":"...", "domain":"...", "weight": 1-5, "recency":"recent|older", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- act_text: VERBATIM, ≤180 chars.",
    "- future_state: distilled, second person, ≤300 chars.",
    "- pull_kind: ONE of seeking/escaping/grieving/entertaining.",
    "- domain: ONE of work/health/relationships/family/finance/creative/self/spiritual/other.",
    "- weight: 1-5.",
    "- recency: recent | older.",
    "- confidence: 1-5.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "DO NOT extract:",
    "- Concrete plans the user has already committed to ('I'm moving to Lisbon next month'). Imagined futures are about MENTAL VISITS, not booked plans.",
    "- Generic 'I want X' statements without an imagining quality. The diagnostic is the user is VISITING the future, not just wanting an outcome.",
    "- Same imagined future twice across nearby messages — pick the cleanest occurrence with the strongest signal of pull_kind.",
    "- Worries about feared futures ('I'm scared I'll end up alone'). Imagined-futures register catches futures the user is DRAWN to, not avoiding.",
    "",
    "British English. No em-dashes. Don't invent imaginings. Quality over quantity. If borderline, emit with confidence=2 so the user can see it.",
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

  let parsed: { imagined_futures?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.imagined_futures)) {
    return NextResponse.json({ error: "model output missing imagined_futures array" }, { status: 502 });
  }

  type ParsedF = {
    act_text?: unknown;
    future_state?: unknown;
    pull_kind?: unknown;
    domain?: unknown;
    weight?: unknown;
    recency?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidF = {
    act_text: string;
    future_state: string;
    pull_kind: string;
    domain: string;
    weight: number;
    recency: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string | null;
  };

  const valid: ValidF[] = [];
  for (const f of parsed.imagined_futures as ParsedF[]) {
    const act = typeof f.act_text === "string" ? f.act_text.trim().slice(0, 220) : "";
    const future = typeof f.future_state === "string" ? f.future_state.trim().slice(0, 360) : "";
    const pullKind = typeof f.pull_kind === "string" && VALID_PULL_KINDS.has(f.pull_kind) ? f.pull_kind : null;
    const domain = typeof f.domain === "string" && VALID_DOMAINS.has(f.domain) ? f.domain : null;
    const weight = typeof f.weight === "number" ? Math.max(1, Math.min(5, Math.round(f.weight))) : 2;
    const recency = typeof f.recency === "string" && VALID_RECENCY.has(f.recency) ? f.recency : "recent";
    const confidence = typeof f.confidence === "number" ? Math.max(1, Math.min(5, Math.round(f.confidence))) : 3;
    const msgId = typeof f.msg_id === "string" ? f.msg_id.trim() : "";

    if (!pullKind || !domain) continue;
    if (act.length < 4 || future.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    valid.push({
      act_text: act,
      future_state: future,
      pull_kind: pullKind,
      domain,
      weight,
      recency,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying imagined futures detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 730 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("imagined_futures")
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
      act_text: v.act_text,
      future_state: v.future_state,
      pull_kind: v.pull_kind,
      domain: v.domain,
      weight: v.weight,
      recency: v.recency,
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
      message: "all detected imagined futures already on file",
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
    .from("imagined_futures")
    .insert(toInsert)
    .select("id, scan_id, act_text, future_state, pull_kind, domain, weight, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, pursue_intention_id, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    imagined_futures: inserted ?? [],
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
