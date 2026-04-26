// POST /api/loops/scan — THE LOOPS REGISTER (§174).
//
// Body: { window_days?: 60-730 (default 365) }
//
// Different shape from §165–§172 scans: those mine for individual
// utterances of certain phrase shapes. This one mines for RECURRENCE —
// themes the user has returned to MORE THAN ONCE across DIFFERENT chats.
// No trigger regex; the model reads the whole sample and decides what
// counts as a recurring concern.
//
// For each loop the model returns: verbatim/distilled topic_text, kind,
// domain, evidence msg_ids (representative occurrences), first/last
// spoken msg_ids, occurrence_count, distinct_chat_count, amplitude,
// velocity, confidence.
//
// Server validates, computes chronicity_days from first/last spoken
// dates, and UPSERTs by (user_id, topic_text) so rescans tighten the
// numbers rather than duplicate.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 5500;

const VALID_LOOP_KINDS = new Set([
  "question", "fear", "problem", "fantasy", "scene_replay",
  "grievance", "craving", "regret_gnaw", "other",
]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);
const VALID_VELOCITIES = new Set(["escalating", "stable", "dampening", "dormant"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }
function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(60, Math.min(730, Math.round(body.window_days ?? 365)));

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

  if (userMessages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in this window — try a longer window" }, { status: 400 });
  }

  // No trigger filter — recurrence needs broad coverage. Filter only by
  // length so we don't waste tokens on one-liners that lack signal.
  const candidates = userMessages.filter((m) => m.content.length >= 30 && m.content.length <= 3000);

  if (candidates.length < 30) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "not enough substantive messages — recurrence needs more data", latency_ms: Date.now() - t0 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 320 ? m.content.slice(0, 280) + " ..." : m.content,
  }));

  // Sample evenly across the window. Loops need temporal coverage so
  // velocity can be read.
  const SAMPLE_LIMIT = 250;
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
  lines.push(`SAMPLED USER MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting RECURRING CONCERNS — themes the user has returned to MORE THAN ONCE across DIFFERENT chats over the window. Not single utterances. Not one-off mentions. RECURRENCE.",
    "",
    "A recurring concern is a question / fear / problem / fantasy / scene the user keeps coming back to without resolution. Same topic, different surfaces. The signal is that the user re-raises it across multiple distinct messages — often in different conversations, days/weeks/months apart. The same emotional knot showing up again and again.",
    "",
    "Examples that QUALIFY:",
    "- 'should I quit my job' raised in 4 chats over 5 months — that's a loop",
    "- 'the thing my brother said in 2019' replayed in 3 chats over 90 days — scene_replay loop",
    "- 'whether to have kids' returned to in 8 chats over 8 months — question loop",
    "- 'I keep wanting a drink at 9pm' across 12 evenings — craving loop",
    "- 'what dad would think of me now' raised every few weeks — grievance/regret_gnaw loop",
    "",
    "DOES NOT qualify:",
    "- a single concern raised once, even if heavy. Loops require recurrence.",
    "- a topic the user EXPLICITLY resolved (one occurrence said 'I decided X, moving on').",
    "- chitchat repetition ('what's for dinner').",
    "",
    "Pick a clean topic_text per loop:",
    "  topic_text — second-person or first-person phrasing of the concern. ≤220 chars. Make it specific enough that the user recognises it. Examples: 'should I quit my corporate job and write full-time?', 'whether the marriage is fixable', 'replaying the call where mum said she was disappointed', 'the dread of opening the bank app', 'wanting to message her again'.",
    "",
    "Loop kinds (pick the dominant frame):",
    "  question      — open question, decision the user keeps revisiting",
    "  fear          — dread of a future event or outcome",
    "  problem       — a perceived broken-ness in life/work/self",
    "  fantasy       — recurring imagined scene that ISN'T pulling toward action (use §171 imagined-futures for actionable pulls)",
    "  scene_replay  — past moment / conversation the user keeps replaying",
    "  grievance     — what someone did, replayed",
    "  craving       — desire that returns and is not chosen",
    "  regret_gnaw   — a thing the user keeps wishing they'd done",
    "  other         — fits no above category",
    "",
    "AMPLITUDE 1-5 (avg intensity per occurrence — read across the evidence):",
    "  1 — light passing mention, mostly ambient",
    "  2 — present but contained",
    "  3 — emotionally weighted; the user names the concern with charge",
    "  4 — heavy; preoccupation evident; the concern colours the chat",
    "  5 — searing; the concern is dominating recent chats",
    "",
    "VELOCITY (compare recent occurrences to older ones in the window):",
    "  escalating — recent occurrences are MORE frequent or MORE intense than older ones",
    "  stable     — flat over time",
    "  dampening  — recent occurrences are less frequent or less intense than older ones",
    "  dormant    — last occurrence is in the older third of the window; concern may be fading",
    "",
    "Output strict JSON ONLY:",
    `{"loops": [{"topic_text":"...", "loop_kind":"...", "domain":"...", "evidence_msg_ids": ["msg1","msg2","msg3"], "first_seen_msg_id":"...", "last_seen_msg_id":"...", "occurrence_count": 2-30, "distinct_chat_count": 1-30, "amplitude": 1-5, "velocity":"escalating|stable|dampening|dormant", "confidence": 1-5}]}`,
    "",
    "Rules:",
    "- topic_text: ≤220 chars; specific; one phrase per loop.",
    "- loop_kind: ONE of question/fear/problem/fantasy/scene_replay/grievance/craving/regret_gnaw/other.",
    "- domain: ONE of work/health/relationships/family/finance/creative/self/spiritual/other.",
    "- evidence_msg_ids: 3-8 EXACT msg_ids from the [date|msg_id|conv:...] tags, picked as representative.",
    "- first_seen_msg_id: the EARLIEST msg_id where this concern is named in the evidence.",
    "- last_seen_msg_id: the LATEST msg_id where this concern is named in the evidence.",
    "- occurrence_count: integer ≥2 (loops require recurrence). Rough count of distinct mentions you can see.",
    "- distinct_chat_count: integer ≥1.",
    "- amplitude / velocity / confidence: as above.",
    "",
    "DO NOT extract:",
    "- one-off concerns. Recurrence required.",
    "- topics the user explicitly closed in the evidence.",
    "- duplicate loops with slightly different phrasings — pick the cleanest framing.",
    "- generic life concerns the user did not actually voice repeatedly.",
    "",
    "Quality over quantity. Aim for 3-12 loops. Each loop must be defensible as a real RECURRING CONCERN with at least 2 distinct evidence message ids. British English. No em-dashes.",
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

  type ParsedL = {
    topic_text?: unknown;
    loop_kind?: unknown;
    domain?: unknown;
    evidence_msg_ids?: unknown;
    first_seen_msg_id?: unknown;
    last_seen_msg_id?: unknown;
    occurrence_count?: unknown;
    distinct_chat_count?: unknown;
    amplitude?: unknown;
    velocity?: unknown;
    confidence?: unknown;
  };

  type ValidL = {
    topic_text: string;
    loop_kind: string;
    domain: string;
    evidence_message_ids: string[];
    first_seen_date: string;
    last_seen_date: string;
    occurrence_count: number;
    distinct_chat_count: number;
    amplitude: number;
    velocity: string;
    confidence: number;
    chronicity_days: number;
  };

  const valid: ValidL[] = [];
  for (const l of parsed.loops as ParsedL[]) {
    const topic = typeof l.topic_text === "string" ? l.topic_text.trim().slice(0, 280) : "";
    const kind = typeof l.loop_kind === "string" && VALID_LOOP_KINDS.has(l.loop_kind) ? l.loop_kind : null;
    const domain = typeof l.domain === "string" && VALID_DOMAINS.has(l.domain) ? l.domain : null;
    const evidenceRaw = Array.isArray(l.evidence_msg_ids) ? l.evidence_msg_ids : [];
    const evidence = evidenceRaw
      .filter((m): m is string => typeof m === "string" && msgDates.has(m))
      .slice(0, 8);
    const firstId = typeof l.first_seen_msg_id === "string" ? l.first_seen_msg_id.trim() : "";
    const lastId = typeof l.last_seen_msg_id === "string" ? l.last_seen_msg_id.trim() : "";
    const occCount = typeof l.occurrence_count === "number" ? Math.max(2, Math.min(30, Math.round(l.occurrence_count))) : 2;
    const distinctChats = typeof l.distinct_chat_count === "number" ? Math.max(1, Math.min(30, Math.round(l.distinct_chat_count))) : 1;
    const amplitude = typeof l.amplitude === "number" ? Math.max(1, Math.min(5, Math.round(l.amplitude))) : 2;
    const velocity = typeof l.velocity === "string" && VALID_VELOCITIES.has(l.velocity) ? l.velocity : "stable";
    const confidence = typeof l.confidence === "number" ? Math.max(1, Math.min(5, Math.round(l.confidence))) : 3;

    if (!kind || !domain) continue;
    if (topic.length < 4) continue;
    if (evidence.length < 2) continue;
    if (confidence < 2) continue;
    if (!firstId || !msgDates.has(firstId)) continue;
    if (!lastId || !msgDates.has(lastId)) continue;

    const firstDate = msgDates.get(firstId) as string;
    const lastDate = msgDates.get(lastId) as string;
    const chronicity = daysBetween(firstDate, lastDate);

    valid.push({
      topic_text: topic,
      loop_kind: kind,
      domain,
      evidence_message_ids: evidence,
      first_seen_date: firstDate,
      last_seen_date: lastDate,
      occurrence_count: occCount,
      distinct_chat_count: distinctChats,
      amplitude,
      velocity,
      confidence,
      chronicity_days: chronicity,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, updated: 0, message: "no qualifying loops detected", latency_ms: Date.now() - t0 });
  }

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  // UPSERT-by-topic_text. We fetch existing rows whose topic_text matches
  // exactly any of the new ones, preserve user-set status / pinned /
  // status_note / archived_at, and update the recurrence metrics.
  const topics = valid.map((v) => v.topic_text);
  const { data: existingRows } = await supabase
    .from("loops")
    .select("id, topic_text, status, status_note, pinned, archived_at, resolved_at")
    .eq("user_id", user.id)
    .in("topic_text", topics);
  const existingByTopic = new Map<string, { id: string; status: string; status_note: string | null; pinned: boolean; archived_at: string | null; resolved_at: string | null }>();
  for (const r of (existingRows ?? [])) existingByTopic.set(r.topic_text, r);

  let inserted = 0;
  let updated = 0;
  const insertedRows: Array<Record<string, unknown>> = [];

  for (const v of valid) {
    const existing = existingByTopic.get(v.topic_text);
    if (existing) {
      const { error: updErr } = await supabase
        .from("loops")
        .update({
          scan_id: scanId,
          loop_kind: v.loop_kind,
          domain: v.domain,
          first_seen_date: v.first_seen_date,
          last_seen_date: v.last_seen_date,
          occurrence_count: v.occurrence_count,
          distinct_chat_count: v.distinct_chat_count,
          chronicity_days: v.chronicity_days,
          amplitude: v.amplitude,
          velocity: v.velocity,
          confidence: v.confidence,
          evidence_message_ids: v.evidence_message_ids,
          latency_ms: latencyMs,
          model,
        })
        .eq("id", existing.id);
      if (!updErr) updated++;
    } else {
      const { data: insRow, error: insErr } = await supabase
        .from("loops")
        .insert({
          user_id: user.id,
          scan_id: scanId,
          topic_text: v.topic_text,
          loop_kind: v.loop_kind,
          domain: v.domain,
          first_seen_date: v.first_seen_date,
          last_seen_date: v.last_seen_date,
          occurrence_count: v.occurrence_count,
          distinct_chat_count: v.distinct_chat_count,
          chronicity_days: v.chronicity_days,
          amplitude: v.amplitude,
          velocity: v.velocity,
          confidence: v.confidence,
          evidence_message_ids: v.evidence_message_ids,
          latency_ms: latencyMs,
          model,
        })
        .select("id, scan_id, topic_text, loop_kind, domain, first_seen_date, last_seen_date, occurrence_count, distinct_chat_count, chronicity_days, amplitude, velocity, confidence, evidence_message_ids, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
        .single();
      if (!insErr && insRow) {
        inserted++;
        insertedRows.push(insRow);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted,
    updated,
    loops: insertedRows,
    latency_ms: latencyMs,
    signals: {
      sampled: sampled.length,
      emitted: valid.length,
      topics_seen_before: existingByTopic.size,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
