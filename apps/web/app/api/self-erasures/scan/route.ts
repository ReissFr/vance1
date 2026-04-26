// POST /api/self-erasures/scan — Self-Erasure Register (§163).
//
// Body: { window_days?: 30-365 (default 120) }
//
// Two-phase mining:
//   Phase 1 — Haiku extracts SELF-ERASURES the user committed. Five kinds:
//     self_dismissal      ("ignore me", "forget I said anything")
//     cancellation        ("never mind", "scratch that", "actually nothing")
//     self_pathologising  ("I'm being silly/dramatic/stupid", "overthinking")
//     minimisation        ("probably nothing", "doesn't matter", "small thing")
//     truncation          ("I was going to say..." then trailing off)
//     For each: erasure_text (verbatim), erasure_kind, what_was_erased
//     (the preceding line being cancelled), what_was_erased_kind, censor_voice
//     (2-5 word inferred internal voice), domain, confidence, msg_id.
//   Phase 2 — server-side: walks user messages and counts other messages
//     with the SAME erasure shape (kind-level regex). Counts how many
//     also had a preceding thought (recurrence_with_target — distinguishes
//     verbal tic from real censorship). Computes pattern_severity.
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
  "self_dismissal", "cancellation", "self_pathologising", "minimisation", "truncation",
]);
const VALID_TARGETS = new Set([
  "feeling", "need", "observation", "request", "opinion", "memory", "idea", "complaint", "unknown",
]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

// Per-kind regex shapes for Phase 2 recurrence — match the SHAPE not specific words.
const KIND_RE: Record<string, RegExp> = {
  self_dismissal: /\b(ignore me|don'?t mind me|forget (?:i said|that i said|i mentioned|what i (?:said|wrote))|forget it|disregard (?:that|what i)|ignore (?:that|what i (?:said|wrote))|nvm|nm|delete that|scratch that)\b/i,
  cancellation: /\b(never\s?mind|nvm|nm|nevermind|actually,? (?:nothing|forget it|never mind|nm)|forget (?:it|i (?:said|asked))|moving on|moot point|doesn'?t matter (?:anymore|now)|skip (?:it|that)|scratch (?:that|what i))\b/i,
  self_pathologising: /\b(i'?m (?:being|just being|prob(?:ably)? being) (?:silly|stupid|weird|dramatic|crazy|paranoid|childish|needy|annoying|too much|extra|ridiculous|over the top|a baby)|i know i'?m (?:being|just being) (?:silly|stupid|weird|dramatic|crazy|paranoid|childish|needy|annoying|too much|extra|ridiculous)|i'?m (?:overthinking|overreacting|spiralling|spiraling|catastrophising|making (?:a )?big deal|reading too much|going on a tangent|rambling|going off|venting)|sorry for (?:venting|rambling|the rant|going on|the dump))\b/i,
  minimisation: /\b(probably nothing|it'?s nothing|nothing really|doesn'?t (?:really )?matter|small thing,? but|tiny thing|stupid little|dumb little|prob(?:ably)? not important|not (?:a )?big deal|whatever it'?s fine|fine fine|not worth (?:saying|mentioning|going into)|forget i mentioned|i'?m fine|never mind it'?s fine|just a small)\b/i,
  truncation: /\b(i was (?:going|gonna) to say|i was about to say|i almost (?:said|asked|told you)|i started to say|i was thinking (?:that|of saying|maybe)?(?:\s*\.\.\.|\s*$)|i'?d say but|i would say but|hmm (?:never mind|forget it|nvm)|on second thought)\b/i,
};

const ANY_ERASURE_RE = new RegExp(
  Object.values(KIND_RE).map((r) => r.source).join("|"),
  "i",
);

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(30, Math.min(365, Math.round(body.window_days ?? 120)));

  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const todayDate = dateOnly(new Date().toISOString());
  const startDate = dateOnly(startIso);

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, role")
    .eq("user_id", user.id)
    .gte("created_at", startIso)
    .order("created_at", { ascending: true })
    .limit(2500);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  type Msg = { id: string; conversation_id: string; content: string; created_at: string; role: string };
  const allMessages = (msgRows ?? []) as Msg[];
  const userMessages = allMessages.filter((m) => m.role === "user");

  if (userMessages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in this window — try a longer window" }, { status: 400 });
  }

  const candidates = userMessages.filter((m) =>
    ANY_ERASURE_RE.test(m.content) &&
    m.content.length >= 12 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no self-erasure found in this window", latency_ms: Date.now() - t0 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 400 ? m.content.slice(0, 360) + " ..." : m.content,
  }));

  const SAMPLE_LIMIT = 130;
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
  lines.push(`SELF-ERASURE CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting SELF-ERASURES — moments where the user OVERRULED their own thought mid-stream. A second voice cancelling the first. Five kinds:",
    "",
    "  self_dismissal       — user dismisses their own contribution: 'ignore me', 'don't mind me', 'forget I said anything', 'forget I asked', 'disregard'.",
    "  cancellation         — user cancels a thought just expressed: 'never mind', 'scratch that', 'actually nothing', 'nvm', 'forget it'.",
    "  self_pathologising   — user labels their own emotion/need as defective: 'I'm being silly', 'I'm being dramatic', 'I'm being needy', 'I'm overthinking', 'I'm spiralling', 'sorry for venting', 'I know I'm being too much'.",
    "  minimisation         — user pre-emptively shrinks their concern: 'probably nothing', 'it's nothing', 'doesn't really matter', 'small thing but', 'not a big deal', 'whatever it's fine', 'I'm fine'.",
    "  truncation           — user signals a thought was almost-said but won't be: 'I was going to say...', 'I almost said', 'I was thinking maybe...', 'on second thought', 'hmm never mind'. The trail-off itself.",
    "",
    "Output strict JSON ONLY:",
    `{"erasures": [{"erasure_text":"...", "erasure_kind":"...", "what_was_erased":"...", "what_was_erased_kind":"...", "censor_voice":"...", "domain":"...", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- erasure_text: VERBATIM erasure phrase from the message. <=160 chars. The actual phrase that performs the cancellation.",
    "- erasure_kind: ONE of self_dismissal | cancellation | self_pathologising | minimisation | truncation.",
    "- what_was_erased: VERBATIM <=240 chars from the SAME or IMMEDIATELY-PRECEDING line — the thought that was cancelled. If clearly identifiable (e.g. user shared a feeling then said 'never mind' — capture the feeling). If the erasure stands alone (verbal tic with no clear preceding content — e.g. 'lol nm' replying to nothing), set this to null.",
    "- what_was_erased_kind: best fit ONE of feeling | need | observation | request | opinion | memory | idea | complaint | unknown. Use 'unknown' only when truly unclear. Set to null if what_was_erased is null.",
    "- censor_voice: 2-5 word phrase NAMING the internal voice that did the erasing — INFERRED from the tone of the cancellation. Examples: 'the editor', 'the reasonable one', 'the don't-be-a-burden voice', 'the calm-it-down voice', 'the it-doesn't-matter voice', 'the don't-bother voice', 'the inner critic', 'the keep-it-light voice'. Lowercase. Be specific to the FLAVOUR of this particular erasure, not generic.",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other.",
    "- confidence: 1-5 (5=clearly self-erasure of real content, 1=likely just verbal tic with no real content cancelled).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- 'never mind' said TO someone else as 'don't worry about it' (not self-erasure)",
    "- Polite phrasing that isn't cancelling a thought ('it's fine, no rush' — not erasing)",
    "- Genuine corrections ('actually I meant Tuesday not Monday' — that's a clarification, not erasure)",
    "- Same erasure twice across nearby messages — pick the cleanest first occurrence",
    "- Cases where the user is QUOTING someone else saying these phrases",
    "",
    "The litmus test: did the user just CANCEL something they themselves had begun to express? If the line before was 'I'm exhausted today' and the next was 'never mind, I'm fine' — that's an erasure of a feeling. If the user wrote 'I really want to ask you to come help but I'm being needy ignore me' — that's an erasure of a need. Surface those.",
    "",
    "Be careful with what_was_erased_kind. If the erased content was 'I'm exhausted' = feeling. If 'can you do this for me' = request. If 'I think she's being unreasonable' = opinion. If 'we used to go there every Sunday' = memory. If 'we should rebuild the dashboard' = idea. If 'it's been hard with him recently' = complaint. If 'I noticed the bill went up' = observation. If 'I really need someone to talk to' = need.",
    "",
    "British English. No em-dashes. Don't invent erasures that aren't in the messages. Quality over quantity. If the message contains an erasure cue but no real content was cancelled (genuine verbal tic), still emit it with what_was_erased=null and confidence=1-2.",
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

  let parsed: { erasures?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.erasures)) {
    return NextResponse.json({ error: "model output missing erasures array" }, { status: 502 });
  }

  type ParsedE = {
    erasure_text?: unknown;
    erasure_kind?: unknown;
    what_was_erased?: unknown;
    what_was_erased_kind?: unknown;
    censor_voice?: unknown;
    domain?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidE = {
    erasure_text: string;
    erasure_kind: string;
    what_was_erased: string | null;
    what_was_erased_kind: string | null;
    censor_voice: string | null;
    domain: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    spoken_conversation_id: string | null;
  };

  const valid: ValidE[] = [];
  for (const e of parsed.erasures as ParsedE[]) {
    const text = typeof e.erasure_text === "string" ? e.erasure_text.trim().slice(0, 200) : "";
    const kind = typeof e.erasure_kind === "string" && VALID_KINDS.has(e.erasure_kind) ? e.erasure_kind : null;
    const erasedRaw = typeof e.what_was_erased === "string" ? e.what_was_erased.trim() : "";
    const erased = erasedRaw.length >= 4 ? erasedRaw.slice(0, 320) : null;
    const erasedKind = typeof e.what_was_erased_kind === "string" && VALID_TARGETS.has(e.what_was_erased_kind) ? e.what_was_erased_kind : null;
    const voiceRaw = typeof e.censor_voice === "string" ? e.censor_voice.trim() : "";
    const voice = voiceRaw.length >= 3 ? voiceRaw.slice(0, 60) : null;
    const domain = typeof e.domain === "string" && VALID_DOMAINS.has(e.domain) ? e.domain : null;
    const confidence = typeof e.confidence === "number" ? Math.max(1, Math.min(5, Math.round(e.confidence))) : 3;
    const msgId = typeof e.msg_id === "string" ? e.msg_id.trim() : "";

    if (!kind || !domain) continue;
    if (text.length < 3) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      erasure_text: text,
      erasure_kind: kind,
      what_was_erased: erased,
      what_was_erased_kind: erased ? erasedKind : null,
      censor_voice: voice,
      domain,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      spoken_conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying self-erasures detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("self_erasures")
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

  type SampleRow = { date: string; snippet: string };

  type Insert = {
    user_id: string;
    scan_id: string;
    erasure_text: string;
    erasure_kind: string;
    what_was_erased: string | null;
    what_was_erased_kind: string | null;
    censor_voice: string | null;
    domain: string;
    spoken_date: string;
    spoken_message_id: string;
    spoken_conversation_id: string | null;
    recurrence_count: number;
    recurrence_days: number;
    recurrence_with_target: number;
    recurrence_samples: SampleRow[];
    pattern_severity: number;
    confidence: number;
    latency_ms: number;
    model: string;
  };

  const toInsert: Insert[] = [];
  const MAX_SAMPLES = 5;

  function snippetAt(content: string, idx: number): string {
    const start = Math.max(0, idx - 70);
    const end = Math.min(content.length, idx + 140);
    const snip = (start > 0 ? "..." : "") + content.slice(start, end).replace(/\n+/g, " ") + (end < content.length ? "..." : "");
    return snip.slice(0, 220);
  }

  for (const c of valid) {
    if (existingMsgIds.has(c.spoken_message_id)) continue;

    const reKind = KIND_RE[c.erasure_kind];

    let recurrenceCount = 1;
    const recurrenceDays = new Set<string>([c.spoken_date]);
    let recurrenceWithTarget = c.what_was_erased ? 1 : 0;
    const samples: SampleRow[] = [];
    const spokenMs = new Date(c.spoken_date + "T12:00:00.000Z").getTime();

    if (reKind) {
      // Heuristic for "had a real preceding thought": message length > 60 chars before the erasure phrase
      // — i.e. there was something to erase, not just a one-liner verbal tic.
      for (const m of userMessages) {
        if (m.id === c.spoken_message_id) continue;
        const idx = m.content.search(reKind);
        if (idx < 0) continue;
        recurrenceCount += 1;
        recurrenceDays.add(dateOnly(m.created_at));
        if (idx >= 60) recurrenceWithTarget += 1;
        const ms = new Date(m.created_at).getTime();
        if (ms < spokenMs && samples.length < MAX_SAMPLES) {
          samples.push({ date: dateOnly(m.created_at), snippet: snippetAt(m.content, idx) });
        }
      }
    }

    samples.sort((a, b) => b.date.localeCompare(a.date));

    let patternSeverity: number;
    if (recurrenceCount >= 12 && recurrenceWithTarget >= 5) patternSeverity = 5;
    else if (recurrenceCount >= 8 && recurrenceWithTarget >= 3) patternSeverity = 4;
    else if (recurrenceCount >= 4 && (c.erasure_kind === "self_pathologising" || c.erasure_kind === "self_dismissal")) patternSeverity = 3;
    else if (recurrenceCount >= 3) patternSeverity = 2;
    else patternSeverity = 1;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      erasure_text: c.erasure_text,
      erasure_kind: c.erasure_kind,
      what_was_erased: c.what_was_erased,
      what_was_erased_kind: c.what_was_erased_kind,
      censor_voice: c.censor_voice,
      domain: c.domain,
      spoken_date: c.spoken_date,
      spoken_message_id: c.spoken_message_id,
      spoken_conversation_id: c.spoken_conversation_id,
      recurrence_count: recurrenceCount,
      recurrence_days: recurrenceDays.size,
      recurrence_with_target: recurrenceWithTarget,
      recurrence_samples: samples,
      pattern_severity: patternSeverity,
      confidence: c.confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  // suppress unused warning for escapeRegex in case not needed
  void escapeRegex;

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new self-erasures to surface — everything detected was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("self_erasures")
    .insert(toInsert)
    .select("id, scan_id, erasure_text, erasure_kind, what_was_erased, what_was_erased_kind, censor_voice, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_with_target, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    erasures: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      erasure_candidates: candidates.length,
      erasures_extracted: valid.length,
    },
  });
}
