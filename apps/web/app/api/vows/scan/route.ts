// POST /api/vows/scan — The Vow Ledger (§172).
//
// Body: { window_days?: 30-730 (default 365 — vows tend to be older) }
//
// Mines the user's chats for VOWS — promises-to-self that have been
// authored at some past moment and are now operative as background rules.
// Distinct from §167 shoulds (felt obligations from others) and from
// §169 thresholds (identity-crossings made). A vow was authored BY the
// user; the question is whether it's still endorsed.
//
// Trigger phrases: "I always X", "I never Y", "I promised myself",
// "I told myself I would", "I swore I would never", "rule I have for
// myself", "thing I always do", "thing I refuse to do", "I made a deal
// with myself", "I committed to", "I decided long ago", "I'm the kind of
// person who never", "I'm the kind of person who always".
//
// One Haiku call extracts vows. For each: verbatim vow_text, distilled
// shadow (what the vow forecloses), optional origin_event, vow_age,
// domain, weight 1-5, recency, confidence.
//
// The novel hooks: shadow (what the vow rules out — every "I will always
// X" implies "I will never not-X") and vow_age (childhood vows are often
// the most load-bearing AND the most likely to be obsolete).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4500;

const VALID_VOW_AGES = new Set(["childhood", "adolescent", "early_adult", "adult", "recent", "unknown"]);
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

const TRIGGER_RE = /\b(i always|i never|i (?:always|never)'?ll|i'?ll never|i'?ll always|i (?:promised|told|swore) myself|i (?:made|have) a (?:rule|deal|pact|promise) (?:with|for) myself|rule i have for myself|the rule is|my rule is|thing i (?:always|never|refuse to) do|i refuse to|i won'?t (?:ever|let myself)|i (?:committed|swore|vowed) to|i decided long ago|since i was (?:little|young|a kid)|ever since (?:my|the)|i'?m (?:the kind of person|someone) who (?:always|never|refuses to|won'?t)|i (?:don'?t|do not) do|on principle|as a matter of principle|i (?:never|always) let myself|never again|never going to)\b/i;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(30, Math.min(730, Math.round(body.window_days ?? 365)));

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
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no vows detected in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`VOW CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting VOWS — promises-to-self the user has authored at some past moment and is now operating as background rules. Distinct from felt obligations (shoulds — those come from others' voices) and from identity-crossings (thresholds — those describe becoming, not committing). A vow is something the user DECIDED, often years ago, and has been carrying.",
    "",
    "Trigger forms: 'I always X', 'I never Y', 'I promised myself', 'I told myself I would', 'I swore I would never', 'rule I have for myself', 'I made a deal with myself', 'I committed to', 'I decided long ago', 'I'm the kind of person who never', 'I'm the kind of person who always', 'on principle', 'never again'.",
    "",
    "Each vow has THREE pieces:",
    "  vow_text     — VERBATIM. The vow as the user said it. ≤180 chars.",
    "  shadow       — distilled. What the vow FORECLOSES — the cost. Every 'I will always X' implies 'I will never not-X'. Every 'I will never Y' rules out a domain. Second person, ≤240 chars. Examples: vow 'I never depend on anyone' -> shadow 'you can't be in deep partnership; you carry everything alone; you can't ask for help even when it would unstick you'. Vow 'I always finish what I start' -> shadow 'you waste time on dead-end projects to avoid the cost of admitting they were wrong; you can't pivot mid-stream'.",
    "  origin_event — OPTIONAL. Trigger event the user named (e.g. 'after my dad left', 'since the bankruptcy', 'after I got burned by X'). Null if not stated. ≤180 chars.",
    "",
    "vow_age — when was this vow forged? Read carefully:",
    "  childhood    — formed before adolescence. Often most load-bearing AND most likely obsolete. ('I learned young not to need anyone.')",
    "  adolescent   — formed in teenage years. ('Since I was 14 I told myself I'd never be like my mum.')",
    "  early_adult  — formed in 20s. ('In my first job I decided I'd never...')",
    "  adult        — formed in mature life.",
    "  recent       — formed in the last year or two.",
    "  unknown      — origin not stated.",
    "",
    "The CRITICAL diagnostic value of vow_age: childhood and adolescent vows were authored by a younger self with less information. The user has been organizing life around them for years without re-examining. Surfacing the age IS the move toward re-authorship.",
    "",
    "Five weights (how load-bearing — how much of life is organized around this vow):",
    "  1 — passing rule. Light. ('I try not to drink during the week.')",
    "  2 — operative pattern. Real but not central. ('I never check work email at weekends.')",
    "  3 — explicit principle. ('I always pay my bills on the day they arrive. It's a thing.')",
    "  4 — load-bearing. Significant life organisation. ('I never let anyone help me with money. Not since the divorce.')",
    "  5 — organizing principle. Identity-level. The user organizes WHO THEY ARE around this. ('I'm the strong one. I never break down. Not in front of anyone. Ever.')",
    "",
    "Recency:",
    "  recent — the user mentioned the vow in the recent reflection.",
    "  older  — the user is recalling a long-standing vow.",
    "",
    "Output strict JSON ONLY:",
    `{"vows": [{"vow_text":"...", "shadow":"...", "origin_event":"..."|null, "vow_age":"...", "domain":"...", "weight": 1-5, "recency":"recent|older", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- vow_text: VERBATIM, ≤180 chars.",
    "- shadow: distilled, second person, ≤240 chars. ALWAYS named — every vow has a shadow. The diagnostic value is in seeing the cost.",
    "- origin_event: VERBATIM if mentioned, null if not.",
    "- vow_age: ONE of childhood/adolescent/early_adult/adult/recent/unknown.",
    "- domain: ONE of work/health/relationships/family/finance/creative/self/spiritual/other.",
    "- weight: 1-5.",
    "- recency: recent | older.",
    "- confidence: 1-5.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "DO NOT extract:",
    "- Felt obligations from others ('I should call my mum') — that's the shoulds register, not vows.",
    "- Identity-crossings ('I never thought I'd hold a boundary') — that's thresholds.",
    "- Active goals or current commitments ('I'm trying to run 5k') — vows are RULES the user already lives by, not aspirations.",
    "- One-off statements without a sense of carried-over commitment ('I'll do that tomorrow').",
    "- Same vow twice across nearby messages — pick the cleanest occurrence.",
    "",
    "British English. No em-dashes. Don't invent vows. Quality over quantity. The shadow MUST be specific — vague shadows are useless. If the shadow is hard to name, the user might not have a vow there.",
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

  let parsed: { vows?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.vows)) {
    return NextResponse.json({ error: "model output missing vows array" }, { status: 502 });
  }

  type ParsedV = {
    vow_text?: unknown;
    shadow?: unknown;
    origin_event?: unknown;
    vow_age?: unknown;
    domain?: unknown;
    weight?: unknown;
    recency?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidV = {
    vow_text: string;
    shadow: string;
    origin_event: string | null;
    vow_age: string;
    domain: string;
    weight: number;
    recency: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string | null;
  };

  const valid: ValidV[] = [];
  for (const v of parsed.vows as ParsedV[]) {
    const vow = typeof v.vow_text === "string" ? v.vow_text.trim().slice(0, 240) : "";
    const shadow = typeof v.shadow === "string" ? v.shadow.trim().slice(0, 280) : "";
    const origin = typeof v.origin_event === "string" && v.origin_event.trim().length >= 4
      ? v.origin_event.trim().slice(0, 240)
      : null;
    const age = typeof v.vow_age === "string" && VALID_VOW_AGES.has(v.vow_age) ? v.vow_age : null;
    const domain = typeof v.domain === "string" && VALID_DOMAINS.has(v.domain) ? v.domain : null;
    const weight = typeof v.weight === "number" ? Math.max(1, Math.min(5, Math.round(v.weight))) : 2;
    const recency = typeof v.recency === "string" && VALID_RECENCY.has(v.recency) ? v.recency : "older";
    const confidence = typeof v.confidence === "number" ? Math.max(1, Math.min(5, Math.round(v.confidence))) : 3;
    const msgId = typeof v.msg_id === "string" ? v.msg_id.trim() : "";

    if (!age || !domain) continue;
    if (vow.length < 4 || shadow.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    valid.push({
      vow_text: vow,
      shadow,
      origin_event: origin,
      vow_age: age,
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
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying vows detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 730 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("vows")
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
      vow_text: v.vow_text,
      shadow: v.shadow,
      origin_event: v.origin_event,
      vow_age: v.vow_age,
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
      message: "all detected vows already on file",
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
    .from("vows")
    .insert(toInsert)
    .select("id, scan_id, vow_text, shadow, origin_event, vow_age, domain, weight, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, revised_to, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    vows: inserted ?? [],
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
