// POST /api/gut-checks/scan — THE GUT-CHECK LEDGER (§179).
//
// Body: { window_days?: 14-540 (default 180) }
//
// Mines the user's chats for moments they voiced a gut feeling without
// articulated reasoning — "something feels off about", "I have a bad
// feeling about", "something tells me", "my gut says", "I just know".
//
// THE NOVEL DIAGNOSTIC is GUT_ACCURACY_RATE — empirical measurement of
// how often the user's gut is right, regardless of whether they followed
// it. Plus the QUADRANT distribution (followed gut x gut was right) which
// surfaces the user's intuition calibration.
//
// UPSERT-by-(user_id, spoken_message_id, gut_text).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 5000;

const VALID_SIGNAL = new Set([
  "warning", "pull", "suspicion", "trust",
  "unease", "certainty", "dread", "nudge", "hunch",
]);
const VALID_DOMAIN = new Set([
  "relationships", "work", "money", "health",
  "decision", "opportunity", "risk", "self", "unknown",
]);
const VALID_RECENCY = new Set(["recent", "older"]);

// Trigger phrases for filtering gut-check candidates. These are utterances
// where the user voices a felt signal not backed by articulated reasoning.
const TRIGGER_RE = /\b(?:(?:my|a)\s+gut\s+(?:says|tells|is telling|feels|told me|said|is screaming)|gut\s+feeling|gut\s+(?:check|sense)|(?:i)\s+(?:just|kind of|sort of)?\s*(?:know|knew|feel|felt)\s+(?:that|like|something|in my bones|deep down|deep in)|something\s+(?:feels|tells|is telling|seems|seemed|seems off|just feels|tells me)|something\s+(?:is|seems|feels)\s+(?:off|wrong|right|weird|odd|fishy)|(?:bad|good|weird|funny|strange|off|uneasy)\s+(?:feeling|vibe|vibes)\s+(?:about|on|with|that)|(?:i\s+have|got|getting)\s+(?:a\s+)?(?:bad|good|weird|funny|strange|off|uneasy)\s+(?:feeling|vibe|vibes|sense)|(?:hunch|inkling|nagging\s+(?:feeling|sense|thought|suspicion))|(?:can'?t|couldn'?t)\s+(?:put|quite put)\s+(?:my|a)\s+finger\s+on\s+it|(?:something|everything)\s+(?:in|inside)\s+me\s+(?:is|was|says|said|tells|told)|(?:in|deep in)\s+my\s+(?:bones|gut|chest|stomach)|(?:i'?m|i\s+am)\s+(?:getting|picking up)\s+(?:weird|bad|good|off)\s+(?:vibes|signals|energy)|(?:doesn'?t|don'?t)\s+feel\s+(?:right|good|like a yes|like a no)|feels\s+(?:right|wrong|off|like a yes|like a no|too good|too easy|forced|fishy)|(?:i\s+can\s+just\s+tell|I\s+can\s+sense|sixth sense)|sus\s+(?:feeling|vibe))\b/i;

function dateOnly(iso: string): string { return iso.slice(0, 10); }

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

  const windowDays = Math.max(14, Math.min(540, Math.round(body.window_days ?? 180)));
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
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no gut-feeling messages found", latency_ms: Date.now() - t0 });
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
  lines.push(`GUT-CHECK CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting GUT CHECKS — moments where the user voiced a felt signal about something WITHOUT articulating a clean reason. Pattern recognition operating below conscious analysis.",
    "",
    "Examples that QUALIFY:",
    "- 'something feels off about the new investor — I can't say why' -> gut_text: 'the new investor is off'; signal_kind: warning; subject_text: 'the new investor'; domain: money; charge: 4",
    "- 'I have a bad feeling about this deal' -> gut_text: 'this deal will go wrong'; signal_kind: dread; subject_text: 'this deal'; domain: opportunity; charge: 4",
    "- 'my gut says move to lisbon' -> gut_text: 'moving to lisbon is right'; signal_kind: pull; subject_text: 'moving to lisbon'; domain: decision; charge: 4",
    "- 'something tells me she's hiding something' -> gut_text: 'she is hiding something'; signal_kind: suspicion; subject_text: 'she'; domain: relationships; charge: 3",
    "- 'I just know this is going to work' -> gut_text: 'this will work'; signal_kind: certainty; subject_text: 'this'; domain: opportunity; charge: 4",
    "- 'something doesn't sit right with the contract' -> gut_text: 'the contract is wrong'; signal_kind: unease; subject_text: 'the contract'; domain: work; charge: 3",
    "- 'I have a hunch the partnership won't last' -> gut_text: 'the partnership will not last'; signal_kind: hunch; subject_text: 'the partnership'; domain: relationships; charge: 3",
    "",
    "DOES NOT qualify:",
    "- articulated reasoning ('I think X because Y' — gut signals come WITHOUT the because).",
    "- factual claims ('I know the meeting is friday' — that's knowledge, not gut).",
    "- emotion reports without directional signal ('I feel sad today' — mood, not gut about something).",
    "- positive vows or principles ('I always trust my instincts' — that's §172 vow).",
    "- shoulds or felt obligations ('I feel I should do X' — that's §168 should).",
    "- past resolved gut signals where the user is reflecting on the outcome (those should already be in the ledger).",
    "- vague speculation without a felt-signal frame ('I wonder if X will happen' — speculation).",
    "",
    "For each gut check output:",
    "  gut_text       — the gut signal distilled, ≤240 chars. SHAPE of the felt signal as a claim about the world. Drop modal hedges. NOT 'I have a bad feeling about the deal'; YES 'this deal will go wrong'. NOT 'my gut says move'; YES 'moving is right'.",
    "  signal_kind    — ONE of: warning / pull / suspicion / trust / unease / certainty / dread / nudge / hunch.",
    "    warning   — 'something is wrong / dangerous / off'",
    "    pull      — 'I'm drawn to this / it feels right'",
    "    suspicion — specific distrust of someone/something",
    "    trust     — specific trust without proof",
    "    unease    — diffuse discomfort",
    "    certainty — 'I just know X is going to happen'",
    "    dread     — heavy negative anticipation",
    "    nudge     — subtle directional pull",
    "    hunch     — speculative guess held with conviction",
    "  subject_text   — OPTIONAL 4-160 chars. What the gut is about. e.g. 'the new investor', 'the move to Berlin', 'Sarah's pitch', 'this contract', 'the second interview'. Null if too vague to nameable.",
    "  domain         — relationships / work / money / health / decision / opportunity / risk / self / unknown.",
    "  charge         — 1-5. Intensity of the felt signal:",
    "    1 — passing nudge",
    "    2 — mild signal",
    "    3 — clear signal",
    "    4 — strong signal that's hard to ignore",
    "    5 — visceral, can't-shake-it gut signal",
    "  recency        — recent (mentioned recently) | older.",
    "  confidence     — 1-5. Your confidence this is a gut signal vs articulated reasoning.",
    "  msg_id         — EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "Output strict JSON ONLY:",
    `{"gut_checks": [{"gut_text":"...", "signal_kind":"...", "subject_text":"..."|null, "domain":"...", "charge": 1-5, "recency":"recent|older", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- gut_text: distilled, ≤240 chars. Capture the SHAPE of the felt signal as a CLAIM about the world.",
    "- signal_kind: ONE of the 9 valid values.",
    "- subject_text: VERBATIM where possible. Null if the subject isn't specific.",
    "- domain: ONE of the 9 valid domains.",
    "- charge: 1-5. Be conservative. Most gut signals are 2-3.",
    "- recency: recent | older.",
    "- confidence: 1-5. DROP if the message has clear articulated reasoning (not a gut signal).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "- DROP confidence < 2.",
    "- DROP if user explicitly resolved the outcome in the same message ('I had a bad feeling and was right' — already resolved).",
    "- DROP if it's a felt obligation, vow, or articulated reasoning rather than a felt-signal claim about the world.",
    "",
    "Quality over quantity. British English. No em-dashes. The signal_kind field carries the FLAVOUR — pick precisely. The user finds out empirically whether their gut is reliable, so be careful about what you classify as a gut signal vs reasoned claim.",
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

  let parsed: { gut_checks?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.gut_checks)) {
    return NextResponse.json({ error: "model output missing gut_checks array" }, { status: 502 });
  }

  type ParsedG = {
    gut_text?: unknown;
    signal_kind?: unknown;
    subject_text?: unknown;
    domain?: unknown;
    charge?: unknown;
    recency?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidG = {
    gut_text: string;
    signal_kind: string;
    subject_text: string | null;
    domain: string;
    charge: number;
    recency: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string;
  };

  const valid: ValidG[] = [];
  const seenLocal = new Set<string>();
  for (const g of parsed.gut_checks as ParsedG[]) {
    const text = typeof g.gut_text === "string" ? g.gut_text.trim().slice(0, 280) : "";
    const signalKind = typeof g.signal_kind === "string" && VALID_SIGNAL.has(g.signal_kind) ? g.signal_kind : null;
    const subjectRaw = typeof g.subject_text === "string" ? g.subject_text.trim() : "";
    const subjectText = subjectRaw.length >= 4 ? subjectRaw.slice(0, 160) : null;
    const domain = typeof g.domain === "string" && VALID_DOMAIN.has(g.domain) ? g.domain : null;
    const charge = typeof g.charge === "number" ? Math.max(1, Math.min(5, Math.round(g.charge))) : 2;
    const recency = typeof g.recency === "string" && VALID_RECENCY.has(g.recency) ? g.recency : "recent";
    const confidence = typeof g.confidence === "number" ? Math.max(1, Math.min(5, Math.round(g.confidence))) : 3;
    const msgId = typeof g.msg_id === "string" ? g.msg_id.trim() : "";

    if (!signalKind || !domain) continue;
    if (text.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    const dedupKey = `${msgId}::${text.toLowerCase()}`;
    if (seenLocal.has(dedupKey)) continue;
    seenLocal.add(dedupKey);

    const spokenDate = msgDates.get(msgId) as string;
    const conversationId = msgConvos.get(msgId) as string;

    valid.push({
      gut_text: text,
      signal_kind: signalKind,
      subject_text: subjectText,
      domain,
      charge,
      recency,
      confidence,
      spoken_date: spokenDate,
      spoken_message_id: msgId,
      conversation_id: conversationId,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying gut-checks detected", latency_ms: Date.now() - t0 });
  }

  // UPSERT-by-(user_id, spoken_message_id, gut_text). Existing rows
  // preserved (don't churn user-set status / outcome / pinned).
  const msgIds = Array.from(new Set(valid.map((v) => v.spoken_message_id)));
  const { data: existingRows } = await supabase
    .from("gut_checks")
    .select("id, spoken_message_id, gut_text")
    .eq("user_id", user.id)
    .in("spoken_message_id", msgIds);
  const existingKey = new Set<string>();
  for (const r of (existingRows ?? [])) existingKey.add(`${r.spoken_message_id}::${r.gut_text}`);

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  const toInsert: Array<Record<string, unknown>> = [];
  let dedupedCount = 0;
  for (const v of valid) {
    const key = `${v.spoken_message_id}::${v.gut_text}`;
    if (existingKey.has(key)) { dedupedCount++; continue; }
    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      gut_text: v.gut_text,
      signal_kind: v.signal_kind,
      subject_text: v.subject_text,
      domain: v.domain,
      charge: v.charge,
      recency: v.recency,
      spoken_date: v.spoken_date,
      spoken_message_id: v.spoken_message_id,
      conversation_id: v.conversation_id,
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
      message: "all detected gut-checks already on file",
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
    .from("gut_checks")
    .insert(toInsert)
    .select("id, scan_id, gut_text, signal_kind, subject_text, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, confidence, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    gut_checks: inserted ?? [],
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
