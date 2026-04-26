// POST /api/used-to/scan — The Used-To Register (§165).
//
// Body: { window_days?: 30-365 (default 120) }
//
// Two-phase mining:
//   Phase 1 — Haiku extracts USED-TO statements the user typed about
//     themselves. Nine kinds: hobby, habit, capability, relationship,
//     place, identity, belief, role, ritual. For each: used_to_text
//     (verbatim ≤200), used_to_kind, what_was (the lost self/thing
//     distilled, ≤320), what_was_kind (activity/practice/trait/etc),
//     longing_score (1-5: 1=neutral, 2=mild reminisce, 3=mild longing,
//     4=clear longing, 5=mourning), domain, confidence, msg_id.
//   Phase 2 — server-side: walks user messages and counts other
//     messages with the SAME used-to shape (kind-level regex). Counts
//     how many ALSO contained a longing word (miss/wish/those days/
//     should have/I should/back when/wish I still — recurrence_with_
//     longing). Computes pattern_severity.
//
// Dedup by (user_id, message_id) so re-scans don't flood.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4500;

const VALID_KINDS = new Set([
  "hobby", "habit", "capability", "relationship", "place", "identity", "belief", "role", "ritual",
]);
const VALID_TARGETS = new Set([
  "activity", "practice", "trait", "person_or_bond", "location", "self_concept", "assumption", "responsibility", "rhythm",
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

// Per-kind regex shapes for Phase 2 recurrence — match the SHAPE of "I used to ___"
// across nine families. The shapes are deliberately specific so that "I used to think
// about that yesterday" doesn't fire belief; only stable past-self references do.
const KIND_RE: Record<string, RegExp> = {
  hobby: /\b(i used to (?:paint|draw|write|read|sing|dance|play (?:guitar|piano|chess|football|tennis|the violin|squash|games)|cook|bake|garden|run|swim|cycle|knit|sew|build|make|photograph|film|sketch|sculpt|woodwork|fish|hike|climb|surf|ski|skate|box|spar|train|lift|stretch|practise|meditate|journal|skateboard))\b/i,
  habit: /\b(i used to (?:wake up early|go to bed early|meditate|journal|exercise|stretch|read every (?:day|morning|night|evening)|drink (?:more )?water|eat breakfast|cook every (?:day|night|evening)|meal prep|plan my (?:day|week|mornings)|review my (?:day|week)|reflect|gym (?:every|3|4|5|6) ?(?:days?|mornings?|nights?)?|train every (?:day|morning|night)|walk every (?:day|morning|evening)))\b/i,
  capability: /\b(i used to be (?:able to|good at|sharp|fit|strong|fast|focused|patient|calm|disciplined|creative|sociable|extroverted|brave|fearless|resilient|easygoing|spontaneous|on top of (?:it|things|my)|so much (?:more )?productive|better at|much (?:better|sharper|more focused|more disciplined)))\b/i,
  relationship: /\b(i used to (?:talk to|see|hang out with|call|message|text|date|spend time with|live with|share (?:everything|a lot) with|tell|hear from)|we used to (?:talk|hang out|see each other|spend time|meet up|grab|share|message|call)|when (?:s?he|they) and i used to|back when (?:we|s?he) and i)\b/i,
  place: /\b(i used to live in|i used to (?:go to|visit|spend time in|hang out in|work in|study in)|when i lived in|back in (?:london|new york|berlin|paris|amsterdam|sydney|melbourne|tokyo|los angeles|san francisco|edinburgh|manchester|university|uni|college|school|the office|the lab|that flat|that house|the gym))\b/i,
  identity: /\b(i used to (?:be a|be an|be the kind of (?:person|guy|girl|woman|man|founder|writer|artist|builder)|consider myself|think of myself as|see myself as)|i was a|i was an|i was the (?:kind of|sort of|guy|girl|one)|once upon a time i)\b/i,
  belief: /\b(i used to (?:believe|think|trust|feel|assume|expect|hope|believe in|be sure that|be convinced (?:that|of))|i used to be (?:sure|convinced|certain|confident) (?:that|of|in))\b/i,
  role: /\b(i used to (?:run|manage|lead|own|own a|build|coach|teach|mentor|host|organise|chair|edit|write for))\b/i,
  ritual: /\b(i used to (?:every (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|morning|evening|weekend|night)|on (?:sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays))|every (?:sunday|saturday|friday|monday|morning|evening|weekend) i used to)\b/i,
};

const ANY_USED_TO_RE = new RegExp(
  Object.values(KIND_RE).map((r) => r.source).join("|"),
  "i",
);

const LONGING_RE = /\b(miss(?:ed|ing)?|wish(?:ed|ing)? (?:i|i'?d|i'?ll|i could|i still)|those (?:were the )?days|the good (?:old )?days|i should (?:get back|return|do that again|start (?:that )?again)|wish i still|back when i (?:was|did|could|had)|do i (?:still|even)|why don'?t i|why did i stop|i miss (?:doing|being|having)|haven'?t (?:done|been) that in|nostalgi(?:a|c))\b/i;

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
    ANY_USED_TO_RE.test(m.content) &&
    m.content.length >= 20 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no used-to references detected in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`USED-TO CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting USED-TO statements — moments where the user typed an 'I used to ___' about THEMSELVES. Each statement is a past-tense identity reference: a former self, habit, capability, person they were close to, place they belonged, belief they held, role they played, ritual they kept. Across many messages these stack into a structural inventory of LOST SELVES — the version of them that has stopped being.",
    "",
    "Nine kinds. Pick the BEST fit; if it overlaps, prefer the more specific:",
    "  hobby        — a creative/recreational activity. 'i used to draw', 'i used to play guitar', 'i used to run every morning'.",
    "  habit        — a recurring practice or routine. 'i used to journal', 'i used to wake up at 6', 'i used to meal prep'.",
    "  capability   — a trait or competence. 'i used to be sharp', 'i used to be more patient', 'i used to be able to focus for 3 hours'.",
    "  relationship — a person or bond. 'i used to talk to her every day', 'we used to hang out', 'i used to share everything with him'.",
    "  place        — a location or context. 'i used to live in london', 'i used to go to that cafe every weekend', 'when i was at university'.",
    "  identity     — a self-concept. 'i used to be a writer', 'i used to think of myself as someone who shipped fast', 'i used to be the guy who'.",
    "  belief       — an assumption or stance. 'i used to believe everyone could be trusted', 'i used to think hard work was enough'.",
    "  role         — a responsibility or position. 'i used to manage 20 people', 'i used to run that whole team', 'i used to host the dinner'.",
    "  ritual       — a recurring time-anchored practice. 'every sunday i used to call mum', 'i used to do a long walk on saturdays'.",
    "",
    "Output strict JSON ONLY:",
    `{"used_tos": [{"used_to_text":"...", "used_to_kind":"...", "what_was":"...", "what_was_kind":"...", "longing_score": 1-5, "domain":"...", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- used_to_text: VERBATIM 'I used to ___' phrase from the message. <=160 chars. Include enough of the sentence to make the lost-self readable.",
    "- used_to_kind: ONE of hobby | habit | capability | relationship | place | identity | belief | role | ritual.",
    "- what_was: the lost self/thing distilled. <=240 chars. Examples: 'i used to draw every sunday morning' -> 'drawing every Sunday morning'. 'i used to be the guy who replied within an hour' -> 'the person who replied within an hour'. 'i used to talk to mum every day' -> 'a daily conversation with mum'. Distil the thing — don't repeat the phrase verbatim. British English.",
    "- what_was_kind: best fit ONE of activity | practice | trait | person_or_bond | location | self_concept | assumption | responsibility | rhythm.",
    "- longing_score: 1-5 reading the EMOTIONAL DELIVERY. 1=neutral biographical fact ('i used to live in london, now i live in manchester'). 2=mild reminisce ('i used to draw, miss it sometimes'). 3=mild longing ('i used to draw and i should pick it up again'). 4=clear longing ('i miss drawing so much, i used to feel free'). 5=mourning ('i used to be that person and i don't know how to get her back'). The score is what makes this a diagnostic finding.",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other.",
    "- confidence: 1-5 (5=clearly a meaningful past-self reference, 1=likely throwaway phrasing).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- 'i used to think' as a thinking verb in present-time reasoning ('i used to think it was X but now i think it's Y') — that's a belief revision, NOT a lost-self reference, UNLESS the user is conveying loss.",
    "- 'i used to' that's QUOTING someone else's speech",
    "- 'i used to' for things the user clearly returned to recently and is doing again",
    "- Same used-to twice across nearby messages — pick the cleanest first occurrence with highest longing_score",
    "",
    "The litmus test: is the user typing a past-tense reference to who they USED TO BE, DO, HAVE, OR BELIEVE — and is there ANY emotional weight (longing, regret, neutral nostalgia, or relief) attached? If yes, capture it. If the user is happy they don't do it anymore (e.g. quit smoking with relief) — capture it with longing_score=1 and confidence=3-4 because the let-go status is informative.",
    "",
    "British English. No em-dashes. Don't invent used-tos that aren't in the messages. Quality over quantity. If borderline, emit with confidence=2 so the user sees it.",
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

  let parsed: { used_tos?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.used_tos)) {
    return NextResponse.json({ error: "model output missing used_tos array" }, { status: 502 });
  }

  type ParsedU = {
    used_to_text?: unknown;
    used_to_kind?: unknown;
    what_was?: unknown;
    what_was_kind?: unknown;
    longing_score?: unknown;
    domain?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidU = {
    used_to_text: string;
    used_to_kind: string;
    what_was: string | null;
    what_was_kind: string | null;
    longing_score: number;
    domain: string;
    confidence: number;
    spoken_date: string;
    message_id: string;
    conversation_id: string | null;
  };

  const valid: ValidU[] = [];
  for (const u of parsed.used_tos as ParsedU[]) {
    const text = typeof u.used_to_text === "string" ? u.used_to_text.trim().slice(0, 200) : "";
    const kind = typeof u.used_to_kind === "string" && VALID_KINDS.has(u.used_to_kind) ? u.used_to_kind : null;
    const wasRaw = typeof u.what_was === "string" ? u.what_was.trim() : "";
    const was = wasRaw.length >= 3 ? wasRaw.slice(0, 320) : null;
    const wasKind = typeof u.what_was_kind === "string" && VALID_TARGETS.has(u.what_was_kind) ? u.what_was_kind : null;
    const longing = typeof u.longing_score === "number" ? Math.max(1, Math.min(5, Math.round(u.longing_score))) : 2;
    const domain = typeof u.domain === "string" && VALID_DOMAINS.has(u.domain) ? u.domain : null;
    const confidence = typeof u.confidence === "number" ? Math.max(1, Math.min(5, Math.round(u.confidence))) : 3;
    const msgId = typeof u.msg_id === "string" ? u.msg_id.trim() : "";

    if (!kind || !domain) continue;
    if (text.length < 3) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      used_to_text: text,
      used_to_kind: kind,
      what_was: was,
      what_was_kind: was ? wasKind : null,
      longing_score: longing,
      domain,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      message_id: msgId,
      conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying used-to statements detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("used_to")
    .select("message_id")
    .eq("user_id", user.id)
    .gte("created_at", yearAgoIso);
  const existingMsgIds = new Set(
    ((existingRows ?? []) as Array<{ message_id: string | null }>)
      .map((r) => r.message_id)
      .filter((s): s is string => typeof s === "string"),
  );

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  type SampleRow = { date: string; snippet: string };

  type Insert = {
    user_id: string;
    scan_id: string;
    used_to_text: string;
    used_to_kind: string;
    what_was: string | null;
    what_was_kind: string | null;
    longing_score: number;
    domain: string;
    spoken_date: string;
    message_id: string;
    conversation_id: string | null;
    recurrence_count: number;
    recurrence_days: number;
    recurrence_with_longing: number;
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
    if (existingMsgIds.has(c.message_id)) continue;

    const reKind = KIND_RE[c.used_to_kind];

    let recurrenceCount = 1;
    const recurrenceDays = new Set<string>([c.spoken_date]);
    let recurrenceWithLonging = c.longing_score >= 3 ? 1 : 0;
    const samples: SampleRow[] = [];
    const spokenMs = new Date(c.spoken_date + "T12:00:00.000Z").getTime();

    if (reKind) {
      for (const m of userMessages) {
        if (m.id === c.message_id) continue;
        const idx = m.content.search(reKind);
        if (idx < 0) continue;
        recurrenceCount += 1;
        recurrenceDays.add(dateOnly(m.created_at));
        if (LONGING_RE.test(m.content)) recurrenceWithLonging += 1;
        const ms = new Date(m.created_at).getTime();
        if (ms < spokenMs && samples.length < MAX_SAMPLES) {
          samples.push({ date: dateOnly(m.created_at), snippet: snippetAt(m.content, idx) });
        }
      }
    }

    samples.sort((a, b) => b.date.localeCompare(a.date));

    let patternSeverity: number;
    if (recurrenceCount >= 10 && recurrenceWithLonging >= 4) patternSeverity = 5;
    else if (recurrenceCount >= 6 && recurrenceWithLonging >= 2) patternSeverity = 4;
    else if (recurrenceCount >= 3 && (c.used_to_kind === "hobby" || c.used_to_kind === "relationship" || c.used_to_kind === "identity")) patternSeverity = 3;
    else if (recurrenceCount >= 3) patternSeverity = 2;
    else patternSeverity = 1;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      used_to_text: c.used_to_text,
      used_to_kind: c.used_to_kind,
      what_was: c.what_was,
      what_was_kind: c.what_was_kind,
      longing_score: c.longing_score,
      domain: c.domain,
      spoken_date: c.spoken_date,
      message_id: c.message_id,
      conversation_id: c.conversation_id,
      recurrence_count: recurrenceCount,
      recurrence_days: recurrenceDays.size,
      recurrence_with_longing: recurrenceWithLonging,
      recurrence_samples: samples,
      pattern_severity: patternSeverity,
      confidence: c.confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new used-to statements to surface — everything detected was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("used_to")
    .insert(toInsert)
    .select("id, scan_id, used_to_text, used_to_kind, what_was, what_was_kind, longing_score, domain, spoken_date, message_id, conversation_id, recurrence_count, recurrence_days, recurrence_with_longing, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    used_tos: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      used_to_candidates: candidates.length,
      used_tos_extracted: valid.length,
    },
  });
}
