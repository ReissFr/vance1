// POST /api/disowned/scan — The Disowned Register (§164).
//
// Body: { window_days?: 30-365 (default 120) }
//
// Two-phase mining:
//   Phase 1 — Haiku extracts DISOWNERSHIPS the user committed. Five kinds:
//     distancing_pronoun   ("you know that feeling when", "we all do this", "people get like that")
//     external_attribution ("the depression hit", "anxiety took over", "stress is doing this to me")
//     abstract_body        ("the chest tightens", "the stomach drops" instead of MY chest / MY stomach)
//     generic_universal    ("everyone has this", "it's just life", "that's how it is")
//     passive_self         ("the gym wasn't visited", "the message didn't get sent" — agentless)
//     For each: disowned_text (verbatim), disowned_kind, what_was_disowned
//     (the I-form first-person reading of what the user actually meant about
//     themselves), what_was_disowned_kind, self_voice (2-5 word inferred
//     internal voice — e.g. "the spectator", "the narrator"), domain,
//     confidence, msg_id.
//   Phase 2 — server-side: walks user messages and counts other messages
//     with the SAME disownership shape (kind-level regex). Counts how many
//     also carried a first-person subject elsewhere in the message
//     (recurrence_with_target — distinguishes stylistic shorthand from
//     genuine identity-disowning). Computes pattern_severity.
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
  "distancing_pronoun", "external_attribution", "abstract_body", "generic_universal", "passive_self",
]);
const VALID_TARGETS = new Set([
  "emotion", "bodily_state", "mental_state", "relationship_dynamic", "behaviour", "need", "desire", "judgment",
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
  distancing_pronoun: /\b(you know that feeling|you know how it (?:is|feels|goes|gets)|you know when you|you ever (?:just )?(?:have|get|feel|find)|you ever feel like|when you (?:feel|get|are|find yourself) like (?:that|this)|we all (?:feel|get|do|have|go through|know)|people (?:get|feel|do|have) (?:this|that|like that)(?:\s+(?:when|sometimes|too))?|one (?:feels|tends to|gets|finds)|someone in (?:my|that|this) position|that'?s just what (?:you|people|we) do|that thing where you|you start to (?:feel|notice|wonder)|when (?:someone|a person) (?:feels|gets|has))\b/i,
  external_attribution: /\b((?:the )?(?:depression|anxiety|stress|panic|fear|rage|anger|sadness|burnout|exhaustion|loneliness|grief|shame|guilt|despair|dread|numbness|emptiness|overwhelm|jealousy|envy|resentment|frustration|self-doubt) (?:hit|came|took over|crept in|set in|kicked in|started|spilled out|did this|is doing|was doing|kept|keeps|just kept|just keeps|got me|landed|walked in|showed up|arrived|won|wins|takes over|took me|grabbed|gripped me|hits)|(?:the )?(?:darkness|fog|cloud|weight|pit|hole|spiral|wave|storm|black dog) (?:came|hit|landed|set in|came back|returned|took over|got me))\b/i,
  abstract_body: /\b(the (?:chest|stomach|throat|head|body|hands?|knees|shoulders|eyes|gut|legs|jaw|heart|skin|face|brain|mind|breath) (?:tightens?|drops|closes|spins|hurts|aches|seizes|locks|shakes|trembles?|tremors?|goes numb|won'?t stop|is heavy|feels heavy|gets heavy|just|races|pounds|stops|won'?t (?:slow|calm) down|is(?:n'?t)? (?:there|here)|wouldn'?t (?:stop|listen)|did(?:n'?t)? (?:cooperate|listen))|tears (?:came|welled|just (?:came|started|fell)|filled|fell|started|wouldn'?t stop)|sleep (?:wasn'?t (?:there|happening)|didn'?t (?:come|happen)|got disrupted|isn'?t happening)|appetite (?:wasn'?t|isn'?t) (?:there|here)|the body just)\b/i,
  generic_universal: /\b(everyone (?:has|goes through|feels|gets|deals with|knows) (?:this|that|it)|everybody (?:has|goes through|feels|gets|deals with|knows) (?:this|that|it)|it'?s just life|that'?s (?:just )?(?:how (?:it|things|life) (?:is|are|goes|works)|life|the way (?:it|things) (?:is|are))|this is just (?:what happens|how it goes|life|how things are)|we all (?:go through this|feel this|deal with this|have these)|nothing (?:special|unusual) about (?:it|this|me)|same as everyone(?: else)?|it'?s (?:totally )?normal|it'?s common|doesn'?t happen to just me|happens to everyone|happens to us all|that'?s (?:just )?how (?:it|things|life) (?:goes|works))\b/i,
  passive_self: /\b((?:the )?(?:gym|run|workout|email|message|call|chat|text|reply|response|task|work|laundry|dishes|appointment|booking|application|deadline|invoice|update|post|note) (?:wasn'?t|isn'?t|hasn'?t been|didn'?t get|wasn'?t getting|never (?:got|went|happened|did)|didn'?t happen|got missed|just didn'?t (?:happen|get done))|nothing (?:got done|happened today|got finished|got sent|got written)|the (?:day|morning|afternoon|evening|week|weekend) (?:got|just got) (?:wasted|lost|away|past)|things (?:weren'?t|didn'?t get) (?:done|finished|started|sent)|(?:work|food|cooking|sleeping|eating|going out|leaving the house) (?:didn'?t|wasn'?t) (?:happen|getting done))\b/i,
};

const ANY_DISOWNED_RE = new RegExp(
  Object.values(KIND_RE).map((r) => r.source).join("|"),
  "i",
);

const FIRST_PERSON_RE = /\b(i|i'?m|i'?ve|i'?ll|i'?d|me|my|mine|myself)\b/i;

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
    ANY_DISOWNED_RE.test(m.content) &&
    m.content.length >= 20 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no disownership detected in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`DISOWNERSHIP CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting DISOWNERSHIPS — moments where the user described their own experience as if it belonged to someone else. The grammatical signature of a SPECTATOR voice — a narrator who watches the user's life from a third-person remove. Five kinds:",
    "",
    "  distancing_pronoun   — user describes self using 'you' / 'we' / 'people' / 'one' / 'someone'. Examples: 'you know that feeling when nothing feels real', 'we all get like this sometimes', 'people just shut down when it's too much', 'you start to wonder if you're the problem'.",
    "  external_attribution — user makes the emotion/state grammatically external, as if it acts upon them. Examples: 'the depression hit again', 'anxiety took over', 'the panic came back', 'burnout walked in', 'the rage just spilled out', 'stress is doing this to me'.",
    "  abstract_body        — user uses 'the' instead of 'my' for their own body/sensation. Examples: 'the chest tightens', 'the stomach drops', 'the throat closes', 'tears came', 'the body just shut down', 'the head spins'. NOT 'my chest tightens' (that's owned).",
    "  generic_universal    — user collapses personal experience into universal claim. Examples: 'everyone has this', 'it's just life', 'that's how it is', 'we all go through this', 'this is normal', 'happens to everyone'.",
    "  passive_self         — user describes their own action with agentless passive. Examples: 'the gym wasn't visited', 'the message didn't get sent', 'the email never went out', 'nothing got done today', 'the day just got wasted', 'things didn't get finished' — when the user IS the unstated actor.",
    "",
    "Output strict JSON ONLY:",
    `{"disownerships": [{"disowned_text":"...", "disowned_kind":"...", "what_was_disowned":"...", "what_was_disowned_kind":"...", "self_voice":"...", "domain":"...", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- disowned_text: VERBATIM disowned phrase from the message. <=160 chars. The actual phrase that performs the disownership.",
    "- disowned_kind: ONE of distancing_pronoun | external_attribution | abstract_body | generic_universal | passive_self.",
    "- what_was_disowned: the I-FORM ACTIVE-VOICE rewrite. <=240 chars. What the user is actually saying about themselves. Examples: 'the depression hit' -> 'I'm depressed and it just landed on me again'. 'the chest tightens' -> 'my chest is tight'. 'you know that feeling when nothing feels real' -> 'I feel like nothing is real right now'. 'everyone has this' -> 'I have this and I'm trying not to let myself see it as my own'. 'the gym wasn't visited' -> 'I didn't go to the gym today'. Capture the I-form rewrite GENTLY and accurately, not aggressively.",
    "- what_was_disowned_kind: best fit ONE of emotion | bodily_state | mental_state | relationship_dynamic | behaviour | need | desire | judgment.",
    "- self_voice: 2-5 word phrase NAMING the internal voice that did the disowning — INFERRED from the flavour. Examples: 'the spectator', 'the narrator', 'the observer', 'the patient', 'the third-person voice', 'the diagnostic voice', 'the reporter', 'the case study voice', 'the it-just-happens voice'. Lowercase. Be specific.",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other.",
    "- confidence: 1-5 (5=clearly disownership of clear self-experience, 1=likely just stylistic/idiom with no real self-experience disowned).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- Genuinely universal observations not about self ('most people have anxiety' said as a general fact in a separate context, not about user's own anxiety)",
    "- Conversational 'you' that's clearly addressing the listener ('you should try this restaurant')",
    "- Idioms that aren't disowning ('it is what it is' on its own without self-context)",
    "- 'the' for things that aren't part of the user's body/experience ('the dog ate the food' — fine)",
    "- Cases where the user is QUOTING someone else",
    "- Same disownership twice across nearby messages — pick the cleanest first occurrence",
    "",
    "The litmus test: is the user describing their OWN experience, but choosing grammar that puts it OUTSIDE themselves? If a person types 'the panic came back today' — they ARE the one panicking. The grammar disowns it. If they type 'you know how it feels when no one calls you back' — they are talking about themselves. The grammar disowns it. Surface those.",
    "",
    "Be careful with what_was_disowned_kind. 'depression', 'anxiety', 'sadness', 'rage' = emotion. 'chest tightens', 'tears came', 'the body shut down' = bodily_state. 'the mind races', 'the head spins', 'foggy', 'numbness' = mental_state. 'we don't talk anymore' (about self+partner) = relationship_dynamic. 'the gym wasn't visited', 'nothing got done' = behaviour. 'one needs to feel held' = need. 'people want to disappear' = desire. 'that's just how I am' = judgment.",
    "",
    "British English. No em-dashes. Don't invent disownerships that aren't in the messages. Quality over quantity. If the message contains a candidate cue but the disownership is borderline (clearly idiomatic/stylistic with no real self-content), still emit it with confidence=1-2 so the user sees it.",
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

  let parsed: { disownerships?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.disownerships)) {
    return NextResponse.json({ error: "model output missing disownerships array" }, { status: 502 });
  }

  type ParsedD = {
    disowned_text?: unknown;
    disowned_kind?: unknown;
    what_was_disowned?: unknown;
    what_was_disowned_kind?: unknown;
    self_voice?: unknown;
    domain?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidD = {
    disowned_text: string;
    disowned_kind: string;
    what_was_disowned: string | null;
    what_was_disowned_kind: string | null;
    self_voice: string | null;
    domain: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    spoken_conversation_id: string | null;
  };

  const valid: ValidD[] = [];
  for (const d of parsed.disownerships as ParsedD[]) {
    const text = typeof d.disowned_text === "string" ? d.disowned_text.trim().slice(0, 200) : "";
    const kind = typeof d.disowned_kind === "string" && VALID_KINDS.has(d.disowned_kind) ? d.disowned_kind : null;
    const reframeRaw = typeof d.what_was_disowned === "string" ? d.what_was_disowned.trim() : "";
    const reframe = reframeRaw.length >= 4 ? reframeRaw.slice(0, 320) : null;
    const reframeKind = typeof d.what_was_disowned_kind === "string" && VALID_TARGETS.has(d.what_was_disowned_kind) ? d.what_was_disowned_kind : null;
    const voiceRaw = typeof d.self_voice === "string" ? d.self_voice.trim() : "";
    const voice = voiceRaw.length >= 3 ? voiceRaw.slice(0, 60) : null;
    const domain = typeof d.domain === "string" && VALID_DOMAINS.has(d.domain) ? d.domain : null;
    const confidence = typeof d.confidence === "number" ? Math.max(1, Math.min(5, Math.round(d.confidence))) : 3;
    const msgId = typeof d.msg_id === "string" ? d.msg_id.trim() : "";

    if (!kind || !domain) continue;
    if (text.length < 3) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      disowned_text: text,
      disowned_kind: kind,
      what_was_disowned: reframe,
      what_was_disowned_kind: reframe ? reframeKind : null,
      self_voice: voice,
      domain,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      spoken_conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying disownerships detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("disowned")
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
    disowned_text: string;
    disowned_kind: string;
    what_was_disowned: string | null;
    what_was_disowned_kind: string | null;
    self_voice: string | null;
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

    const reKind = KIND_RE[c.disowned_kind];

    let recurrenceCount = 1;
    const recurrenceDays = new Set<string>([c.spoken_date]);
    let recurrenceWithTarget = c.what_was_disowned ? 1 : 0;
    const samples: SampleRow[] = [];
    const spokenMs = new Date(c.spoken_date + "T12:00:00.000Z").getTime();

    if (reKind) {
      // Heuristic for "had a real first-person subject available": message
      // also contains a first-person pronoun elsewhere — i.e. the user IS
      // talking about themselves, but chose distancing grammar for this clause.
      for (const m of userMessages) {
        if (m.id === c.spoken_message_id) continue;
        const idx = m.content.search(reKind);
        if (idx < 0) continue;
        recurrenceCount += 1;
        recurrenceDays.add(dateOnly(m.created_at));
        if (FIRST_PERSON_RE.test(m.content)) recurrenceWithTarget += 1;
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
    else if (recurrenceCount >= 4 && (c.disowned_kind === "external_attribution" || c.disowned_kind === "abstract_body")) patternSeverity = 3;
    else if (recurrenceCount >= 3) patternSeverity = 2;
    else patternSeverity = 1;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      disowned_text: c.disowned_text,
      disowned_kind: c.disowned_kind,
      what_was_disowned: c.what_was_disowned,
      what_was_disowned_kind: c.what_was_disowned_kind,
      self_voice: c.self_voice,
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

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new disownerships to surface — everything detected was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("disowned")
    .insert(toInsert)
    .select("id, scan_id, disowned_text, disowned_kind, what_was_disowned, what_was_disowned_kind, self_voice, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_with_target, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    disownerships: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      disowned_candidates: candidates.length,
      disownerships_extracted: valid.length,
    },
  });
}
