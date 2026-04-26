// POST /api/almosts/scan — The Almost-Register (§170).
//
// Body: { window_days?: 30-730 (default 180) }
//
// Mirror of /thresholds. Where thresholds catalogue identity-crossings
// the user DID make, almosts catalogue the ones they ALMOST made and
// pulled back from at the last second.
//
// Trigger phrases: "I almost", "I was about to", "I nearly", "I came
// close to", "I started to", "I had my hand on", "I drafted it but
// didn't send", "I picked up the phone and put it down", "I started
// typing then deleted", "I was going to but", "I almost replied",
// "I almost quit", "stopped myself", "talked myself out of", "second
// guessed myself".
//
// One Haiku call extracts near-misses. For each: verbatim act_text,
// distilled pulled_back_by, optional consequence_imagined, kind,
// domain, weight, recency, regret_tilt, confidence, msg_id.
//
// The novel hook: regret_tilt. Same surface phrase ("I almost quit")
// can mean RELIEF (thank god I didn't — the brake was wisdom) or
// REGRET (I wish I had — the brake was fear). Naming the difference
// IS the move.
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

const VALID_KINDS = new Set([
  "reaching_out", "saying_no", "leaving", "staying", "starting", "quitting",
  "spending", "refusing", "confronting", "asking", "confessing", "other",
]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other",
]);
const VALID_TILTS = new Set(["relief", "regret", "mixed"]);
const VALID_RECENCY = new Set(["recent", "older"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

const TRIGGER_RE = /\b(i (?:almost|nearly|very nearly|just about|just barely)|i was (?:about to|going to|gonna|just about to|on the verge of)|i came (?:close to|this close)|i started to (?:say|write|type|draft|tell|reach|call|book|buy|leave|walk|reply|message)|i had my (?:hand on|finger on)|i (?:drafted|wrote|typed) (?:it|the message|the email|the reply) but (?:didn'?t|i didn'?t)|i picked up the phone (?:and|but)|i (?:opened|started) (?:the|a) (?:message|reply|email|draft)|i started typing|started typing then (?:deleted|stopped|backed out)|i was going to (?:say|reply|tell|ask|message|call|book|buy|quit|leave) but|stopped myself|talked myself out of|nearly (?:said|sent|replied|booked|bought|asked|told|messaged|called)|backed out|chickened out|got cold feet|second(?:-| )?guessed myself|pulled back at the last (?:second|minute|moment))\b/i;

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
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no near-misses detected in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`NEAR-MISS CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting NEAR-MISSES — moments where the user typed something that names ALMOST doing or saying something but pulling back at the last second. The act did NOT happen. The brake came on. The data is in WHAT the user almost did and WHAT stopped them.",
    "",
    "Trigger forms: 'I almost X', 'I was about to X but', 'I nearly X', 'I started typing but deleted', 'I drafted the reply but didn't send', 'I picked up the phone and put it down', 'I came close to X', 'stopped myself', 'talked myself out of', 'chickened out of', 'backed out at the last minute'.",
    "",
    "Each near-miss has THREE pieces:",
    "  act_text         — VERBATIM phrase. What you ALMOST did. ≤180 chars.",
    "  pulled_back_by   — distilled. WHAT stopped you. A voice, a fear, a remembered fact, exhaustion. ≤200 chars. Second person ('you remembered the deadline', 'mum's voice came in', 'the fear that he'd say no').",
    "  consequence_imagined — OPTIONAL. ≤300 chars. If the user named what they imagined would happen if they'd gone through with it. Often empty.",
    "",
    "The novel signal you must capture: REGRET_TILT. Read the surrounding tone:",
    "  relief — the user is GLAD the brake came on. 'thank god I didn't', 'I'm so glad I stopped', 'that would have been a mess', 'I dodged it'. The brake was wisdom.",
    "  regret — the user wishes they HAD gone through with it. 'I should have', 'I wish I'd just sent it', 'I was such a coward', 'I let myself down again', 'I keep doing this'. The brake was fear, not wisdom.",
    "  mixed  — both. Don't default to mixed for safety; pick one if either is clearly dominant.",
    "",
    "Twelve kinds. Pick the BEST fit:",
    "  reaching_out  — almost messaged / called / contacted someone. 'almost texted my ex', 'started a draft to my mum'.",
    "  saying_no     — almost declined / refused / pushed back. 'I was about to say no but said yes again'.",
    "  leaving       — almost walked out / quit a place or situation. 'I nearly walked out of the meeting', 'almost left him at the table'.",
    "  staying       — almost decided to stay where you were. 'I almost just stayed in bed', 'I was going to stay another year'.",
    "  starting      — almost began something. 'I almost started writing again', 'I came close to booking the trip'.",
    "  quitting      — almost ended / stopped something. 'I almost quit my job', 'I came close to deleting the account'.",
    "  spending      — almost spent / invested / bought something. 'I had it in the basket', 'almost transferred the money'.",
    "  refusing      — almost refused something offered. 'I was about to refuse the role'.",
    "  confronting   — almost called someone out. 'I was about to tell him exactly what I thought'.",
    "  asking        — almost asked for something. 'I drafted the email asking for a raise'.",
    "  confessing    — almost said something hidden out loud. 'I came close to telling her how I really feel'.",
    "  other         — only if none above fit cleanly.",
    "",
    "Five weights (how close you came):",
    "  1 — fleeting impulse. ('I almost ordered the chips.')",
    "  2 — considered for a moment. ('I nearly replied to him.')",
    "  3 — deliberated, decided to pull back. ('I drafted the message and held it for a day.')",
    "  4 — finger on the trigger. ('I had the phone in my hand. I had the message ready. I just didn't send.')",
    "  5 — full commitment, last-second reversal. ('I'd booked the flight. I cancelled it the morning of.', 'I handed in the resignation and asked for it back an hour later.')",
    "",
    "Crossed recency:",
    "  recent — the near-miss happened in or near the window the user is reflecting on.",
    "  older  — the user is recalling a near-miss from years ago.",
    "",
    "Output strict JSON ONLY:",
    `{"almosts": [{"act_text":"...", "pulled_back_by":"...", "consequence_imagined": null|"...", "kind":"...", "domain":"...", "weight": 1-5, "recency":"recent|older", "regret_tilt":"...", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- act_text: VERBATIM utterance, ≤180 chars. The actual phrase.",
    "- pulled_back_by: distilled. Second person. ≤200 chars. Required and substantive — if the user didn't name what stopped them, infer the most likely brake from the message context (a voice, a fear, exhaustion, a remembered fact). Don't invent specifics that aren't there. If you genuinely cannot tell, drop the row.",
    "- consequence_imagined: ≤300 chars or null. Only if the user named or strongly implied what they imagined would happen.",
    "- kind: ONE of the 12 above.",
    "- domain: ONE of work/health/relationships/family/finance/creative/self/spiritual/other.",
    "- weight: 1-5.",
    "- recency: recent | older.",
    "- regret_tilt: relief | regret | mixed.",
    "- confidence: 1-5.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "DO NOT extract:",
    "- Hypothetical futures ('I might quit one day'). Almosts are about a SPECIFIC moment where the brake came on.",
    "- Things the user actually DID ('I almost said no but I said no anyway and walked out' — that's a threshold §169, not an almost).",
    "- Vague counterfactuals ('I could have done X'). Almosts are about a real near-miss with a real pull-back.",
    "- Same near-miss twice across nearby messages — pick the cleanest occurrence.",
    "",
    "British English. No em-dashes. Don't invent near-misses. Quality over quantity. If borderline, emit with confidence=2 so the user can see it.",
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

  let parsed: { almosts?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.almosts)) {
    return NextResponse.json({ error: "model output missing almosts array" }, { status: 502 });
  }

  type ParsedA = {
    act_text?: unknown;
    pulled_back_by?: unknown;
    consequence_imagined?: unknown;
    kind?: unknown;
    domain?: unknown;
    weight?: unknown;
    recency?: unknown;
    regret_tilt?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidA = {
    act_text: string;
    pulled_back_by: string;
    consequence_imagined: string | null;
    kind: string;
    domain: string;
    weight: number;
    recency: string;
    regret_tilt: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string | null;
  };

  const valid: ValidA[] = [];
  for (const a of parsed.almosts as ParsedA[]) {
    const act = typeof a.act_text === "string" ? a.act_text.trim().slice(0, 220) : "";
    const pulled = typeof a.pulled_back_by === "string" ? a.pulled_back_by.trim().slice(0, 220) : "";
    const consequence = typeof a.consequence_imagined === "string" && a.consequence_imagined.trim().length > 0
      ? a.consequence_imagined.trim().slice(0, 300)
      : null;
    const kind = typeof a.kind === "string" && VALID_KINDS.has(a.kind) ? a.kind : null;
    const domain = typeof a.domain === "string" && VALID_DOMAINS.has(a.domain) ? a.domain : null;
    const weight = typeof a.weight === "number" ? Math.max(1, Math.min(5, Math.round(a.weight))) : 2;
    const recency = typeof a.recency === "string" && VALID_RECENCY.has(a.recency) ? a.recency : "recent";
    const tilt = typeof a.regret_tilt === "string" && VALID_TILTS.has(a.regret_tilt) ? a.regret_tilt : null;
    const confidence = typeof a.confidence === "number" ? Math.max(1, Math.min(5, Math.round(a.confidence))) : 3;
    const msgId = typeof a.msg_id === "string" ? a.msg_id.trim() : "";

    if (!kind || !domain || !tilt) continue;
    if (act.length < 4 || pulled.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    valid.push({
      act_text: act,
      pulled_back_by: pulled,
      consequence_imagined: consequence,
      kind,
      domain,
      weight,
      recency,
      regret_tilt: tilt,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying near-misses detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 730 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("almosts")
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
      pulled_back_by: v.pulled_back_by,
      consequence_imagined: v.consequence_imagined,
      kind: v.kind,
      domain: v.domain,
      weight: v.weight,
      recency: v.recency,
      regret_tilt: v.regret_tilt,
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
      message: "all detected near-misses already on file",
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
    .from("almosts")
    .insert(toInsert)
    .select("id, scan_id, act_text, pulled_back_by, consequence_imagined, kind, domain, weight, recency, regret_tilt, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, retry_intention_id, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    almosts: inserted ?? [],
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
