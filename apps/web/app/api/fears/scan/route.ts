// POST /api/fears/scan — THE FEAR LEDGER (§180).
//
// Body: { window_days?: 14-540 (default 180) }
//
// Mines the user's chats for moments they voiced a FEAR — "I'm afraid that",
// "I worry that", "what if X", "it scares me that", "my biggest fear is",
// "I'm terrified that", "I keep having this fear that".
//
// THE NOVEL DIAGNOSTIC is FEAR_REALISATION_RATE — empirical measurement of
// how many of the user's articulated fears actually came true. Pairs with
// §179 GUT_ACCURACY_RATE to give an empirical view of the inner alarm system.
//
// UPSERT-by-(user_id, spoken_message_id, fear_text).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 5000;

const VALID_KIND = new Set([
  "catastrophising", "abandonment", "rejection", "failure",
  "loss", "shame", "inadequacy", "loss_of_control",
  "mortality", "future_uncertainty",
]);
const VALID_DOMAIN = new Set([
  "relationships", "work", "money", "health",
  "decision", "opportunity", "safety", "self", "unknown",
]);
const VALID_RECENCY = new Set(["recent", "older"]);

const TRIGGER_RE = /\b(?:(?:i'?m|i\s+am)\s+(?:afraid|scared|terrified|worried|anxious|fearful|nervous)\s+(?:that|of|about)|(?:i)\s+(?:fear|worry|dread)\s+(?:that|about|i'?ll|i\s+will|it\s+will|they\s+will|she\s+will|he\s+will)|(?:what\s+if)\s+(?:i|we|they|she|he|it|this)|(?:my|biggest|worst)\s+(?:fear|fears|worry|worries|nightmare)\s+(?:is|are|that)|(?:i\s+keep|keep)\s+(?:having|getting|thinking)\s+(?:a|this|the)?\s*(?:fear|worry|thought)\s+(?:that|about)|(?:i'?m|i\s+am)\s+(?:so|really|just)?\s*(?:scared|worried|afraid|terrified)|(?:it\s+scares|it\s+terrifies|it\s+frightens)\s+me|(?:i\s+can'?t\s+stop)\s+(?:worrying|thinking|fearing)\s+(?:about|that)|(?:scared|afraid|worried|terrified)\s+(?:that|of|i'?ll|i\s+will|it'?ll|it\s+will)|(?:i\s+have|got|getting)\s+(?:a|this)\s+(?:fear|worry|dread|sense\s+of\s+dread)|(?:what\s+happens\s+if)|(?:in\s+the\s+back\s+of\s+my\s+mind)\s+(?:i'?m|i\s+am)\s+(?:worried|afraid|scared)|(?:keeps|keep)\s+me\s+(?:up|awake)\s+at\s+night|(?:i'?m|i\s+am)\s+(?:dreading|panicking)\s+(?:about|that))\b/i;

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
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no fear-articulation messages found", latency_ms: Date.now() - t0 });
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
  lines.push(`FEAR-CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting FEARS — moments where the user articulated a feared event or outcome. The fear has a specific feared CLAIM about the future.",
    "",
    "Examples that QUALIFY:",
    "- 'I'm scared this hire is going to flop' -> fear_text: 'this hire will flop'; fear_kind: failure; feared_subject: 'this hire'; domain: work; charge: 4",
    "- 'what if she leaves when I tell her' -> fear_text: 'she will leave when I tell her'; fear_kind: abandonment; feared_subject: 'she'; domain: relationships; charge: 4",
    "- 'I worry I won't make rent next month' -> fear_text: 'I will not make rent next month'; fear_kind: loss; feared_subject: 'rent'; domain: money; charge: 4",
    "- 'my biggest fear is being seen as fraud' -> fear_text: 'I will be seen as a fraud'; fear_kind: shame; feared_subject: null; domain: self; charge: 5",
    "- 'I'm terrified the deal collapses last minute' -> fear_text: 'the deal will collapse last minute'; fear_kind: catastrophising; feared_subject: 'the deal'; domain: opportunity; charge: 4",
    "- 'what if I freeze on the call' -> fear_text: 'I will freeze on the call'; fear_kind: failure; feared_subject: 'the call'; domain: work; charge: 3",
    "- 'I keep having this fear that I'll never finish it' -> fear_text: 'I will never finish it'; fear_kind: inadequacy; feared_subject: 'it'; domain: work; charge: 3",
    "- 'I'm afraid he'll see how angry I really am' -> fear_text: 'he will see how angry I really am'; fear_kind: shame; feared_subject: 'he'; domain: relationships; charge: 3",
    "",
    "DOES NOT qualify:",
    "- gut signals without a future-event claim ('something feels off' — that's §179 gut-check).",
    "- past-fact statements ('I was scared yesterday' — emotion report, not future fear).",
    "- vague mood reports ('I feel anxious today' — mood, not specific fear).",
    "- shoulds or felt obligations ('I should be afraid of X' — that's §168 should).",
    "- generic worries about the world / other people ('I worry about climate change' — too diffuse to resolve).",
    "- already-resolved fears the user is reflecting on ('I was afraid X but it didn't happen' — that's a past resolution).",
    "- vows ('I will never be afraid again' — that's §172 vow).",
    "",
    "For each fear output:",
    "  fear_text       — the feared event/outcome distilled, ≤240 chars. SHAPE of the feared CLAIM about the future. NOT 'I'm afraid X' but 'X will happen'. Drop the I-am-afraid frame, keep the feared event.",
    "  fear_kind       — ONE of: catastrophising / abandonment / rejection / failure / loss / shame / inadequacy / loss_of_control / mortality / future_uncertainty.",
    "    catastrophising      — 'everything is going to fall apart'",
    "    abandonment          — 'they will leave / cut me off'",
    "    rejection            — 'they will say no / pull away / not pick me'",
    "    failure              — 'I will not be able to do this'",
    "    loss                 — 'I will lose [thing/person/money/status]'",
    "    shame                — 'I will be exposed as X / they will see Y'",
    "    inadequacy           — 'I am not enough / will be found out'",
    "    loss_of_control      — 'I will not be able to handle / contain X'",
    "    mortality            — fear of death / illness / serious harm",
    "    future_uncertainty   — diffuse worry about an unknown future",
    "  feared_subject  — OPTIONAL 4-160 chars. What/who the fear is about. e.g. 'the move to Berlin', 'Sarah's response', 'next week's pitch', 'the seed round'. Null if too diffuse.",
    "  domain          — relationships / work / money / health / decision / opportunity / safety / self / unknown.",
    "  charge          — 1-5. Felt intensity:",
    "    1 — passing worry",
    "    2 — mild worry",
    "    3 — clear, recurring fear",
    "    4 — strong fear that's hard to ignore",
    "    5 — visceral fear that's bending behaviour",
    "  recency         — recent | older.",
    "  confidence      — 1-5. Your confidence this is an articulated fear with a feared event.",
    "  msg_id          — EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "Output strict JSON ONLY:",
    `{"fears": [{"fear_text":"...", "fear_kind":"...", "feared_subject":"..."|null, "domain":"...", "charge": 1-5, "recency":"recent|older", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- fear_text: distilled, ≤240 chars. The feared CLAIM about the future, not the I-am-afraid frame.",
    "- fear_kind: ONE of the 10 valid values.",
    "- feared_subject: VERBATIM where possible. Null if too diffuse.",
    "- domain: ONE of the 9 valid domains.",
    "- charge: 1-5. Be conservative. Most articulated fears are 2-3.",
    "- recency: recent | older.",
    "- confidence: 1-5. DROP if the message has no specific feared event (just diffuse anxiety).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "- DROP confidence < 2.",
    "- DROP if the fear is already resolved in the same message ('I was afraid X but it never happened').",
    "- DROP if it's a gut-signal claim about the present, a vow, a should, or a non-specific mood report.",
    "",
    "Quality over quantity. British English. No em-dashes. The fear_kind field carries the FLAVOUR — pick precisely. The user finds out empirically how often their fears realise, so be careful about what you classify as a fear.",
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

  let parsed: { fears?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.fears)) {
    return NextResponse.json({ error: "model output missing fears array" }, { status: 502 });
  }

  type ParsedF = {
    fear_text?: unknown;
    fear_kind?: unknown;
    feared_subject?: unknown;
    domain?: unknown;
    charge?: unknown;
    recency?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidF = {
    fear_text: string;
    fear_kind: string;
    feared_subject: string | null;
    domain: string;
    charge: number;
    recency: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string;
  };

  const valid: ValidF[] = [];
  const seenLocal = new Set<string>();
  for (const f of parsed.fears as ParsedF[]) {
    const text = typeof f.fear_text === "string" ? f.fear_text.trim().slice(0, 280) : "";
    const kind = typeof f.fear_kind === "string" && VALID_KIND.has(f.fear_kind) ? f.fear_kind : null;
    const subjectRaw = typeof f.feared_subject === "string" ? f.feared_subject.trim() : "";
    const subjectText = subjectRaw.length >= 4 ? subjectRaw.slice(0, 160) : null;
    const domain = typeof f.domain === "string" && VALID_DOMAIN.has(f.domain) ? f.domain : null;
    const charge = typeof f.charge === "number" ? Math.max(1, Math.min(5, Math.round(f.charge))) : 2;
    const recency = typeof f.recency === "string" && VALID_RECENCY.has(f.recency) ? f.recency : "recent";
    const confidence = typeof f.confidence === "number" ? Math.max(1, Math.min(5, Math.round(f.confidence))) : 3;
    const msgId = typeof f.msg_id === "string" ? f.msg_id.trim() : "";

    if (!kind || !domain) continue;
    if (text.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    const dedupKey = `${msgId}::${text.toLowerCase()}`;
    if (seenLocal.has(dedupKey)) continue;
    seenLocal.add(dedupKey);

    const spokenDate = msgDates.get(msgId) as string;
    const conversationId = msgConvos.get(msgId) as string;

    valid.push({
      fear_text: text,
      fear_kind: kind,
      feared_subject: subjectText,
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
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying fears detected", latency_ms: Date.now() - t0 });
  }

  const msgIds = Array.from(new Set(valid.map((v) => v.spoken_message_id)));
  const { data: existingRows } = await supabase
    .from("fears")
    .select("id, spoken_message_id, fear_text")
    .eq("user_id", user.id)
    .in("spoken_message_id", msgIds);
  const existingKey = new Set<string>();
  for (const r of (existingRows ?? [])) existingKey.add(`${r.spoken_message_id}::${r.fear_text}`);

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  const toInsert: Array<Record<string, unknown>> = [];
  let dedupedCount = 0;
  for (const v of valid) {
    const key = `${v.spoken_message_id}::${v.fear_text}`;
    if (existingKey.has(key)) { dedupedCount++; continue; }
    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      fear_text: v.fear_text,
      fear_kind: v.fear_kind,
      feared_subject: v.feared_subject,
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
      message: "all detected fears already on file",
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
    .from("fears")
    .insert(toInsert)
    .select("id, scan_id, fear_text, fear_kind, feared_subject, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, confidence, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    fears: inserted ?? [],
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
