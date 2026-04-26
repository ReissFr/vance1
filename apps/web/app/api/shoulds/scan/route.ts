// POST /api/shoulds/scan — The Should Ledger (§166).
//
// Body: { window_days?: 30-365 (default 120) }
//
// Two-phase mining:
//   Phase 1 — Haiku extracts SHOULD statements the user typed about
//     themselves. Eight kinds: moral, practical, social, relational,
//     health, identity, work, financial. For each: should_text
//     (verbatim ≤200), should_kind, distilled_obligation (what the user
//     is actually saying they ought to do, ≤320), obligation_source
//     (whose voice put this should there: self / parent / partner /
//     inner_critic / social_norm / professional_norm / financial_judge /
//     abstract_other), charge_score (1-5: 1=casual, 5=guilt-saturated),
//     domain, confidence, msg_id.
//   Phase 2 — server-side: walks user messages and counts other
//     messages with the SAME should shape. Counts how many ALSO
//     contained a guilt word (guilty/feel bad/keep meaning to/
//     been meaning to/haven't been able to — recurrence_with_charge).
//     Computes pattern_severity.
//
// The novel hook: obligation_source. Naming WHOSE voice the should is.
// Plus a release valve (status='released') so the user can consciously
// let go of shoulds that aren't actually theirs to carry.
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
  "moral", "practical", "social", "relational", "health", "identity", "work", "financial",
]);
const VALID_SOURCES = new Set([
  "self", "parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "abstract_other",
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

// Per-kind regex shapes for Phase 2 recurrence. The shapes match common
// "I should ___" surface forms across eight families. They deliberately
// avoid catching present-tense reasoning ('I should think about this')
// by anchoring on action verbs.
const KIND_RE: Record<string, RegExp> = {
  moral: /\b(i (?:really )?(?:should|shouldn'?t|ought to|need to|have to|must) (?:be (?:more|less|kinder|gentler|patient|honest|grateful|present|forgiving|generous|humble)|treat|act|behave|stop being))\b/i,
  practical: /\b(i (?:really )?(?:should|need to|have to|gotta|must) (?:sort|fix|finish|do|tidy|clean|organise|sort out|get|finalise|complete|tackle|handle|deal with|wrap up|book|order|reply to|email|write|prepare))\b/i,
  social: /\b(i (?:really )?(?:should|ought to|need to|have to|gotta) (?:call|text|reach out|catch up|invite|see|visit|message|email|ring|drop in on|check in on|see more of))\b/i,
  relational: /\b(i (?:really )?(?:should|ought to|need to|have to) (?:be more (?:patient|present|kind|attentive|loving|supportive) (?:with|to|towards)|spend more time with|listen (?:more )?to|apologise to|tell|talk to|open up to|stop (?:ignoring|avoiding|snapping at|being short with)))\b/i,
  health: /\b(i (?:really )?(?:should|need to|have to|gotta|must) (?:eat|sleep|exercise|run|stretch|walk|drink (?:more )?water|stop drinking|stop smoking|cut down on|go to bed|see a doctor|see a dentist|get checked|book a (?:gp|doctor|dentist|therapist)|lose weight|gain weight|train|gym|meditate|stop eating))\b/i,
  identity: /\b(i (?:really )?(?:should|ought to) be (?:the kind of person who|more|less|someone who|the sort of))\b/i,
  work: /\b(i (?:really )?(?:should|need to|have to|gotta|must) (?:work harder|finish (?:that|the) (?:report|deck|brief|email|doc|spec|pr)|reply to|email|message|do that thing for|push (?:that|the)|ship|deliver|review|send|prepare for|prep|do prep))\b/i,
  financial: /\b(i (?:really )?(?:should|need to|have to|gotta|must) (?:save (?:more|up)|stop spending|budget|invest|pay off|cancel that subscription|cancel (?:my|that)|cut down on (?:spending|takeaways|coffees)|tighten|stop buying|track (?:my )?(?:spending|expenses|finances)))\b/i,
};

const ANY_SHOULD_RE = new RegExp(
  Object.values(KIND_RE).map((r) => r.source).join("|"),
  "i",
);

const CHARGE_RE = /\b(guilty|guilt|bad about|terrible|awful|ashamed|feel bad|feeling bad|keep meaning to|been meaning to|haven'?t (?:been able to|managed to|got round to|got around to|done it)|i'?m a (?:bad|terrible|awful)|disappointing|let (?:myself|him|her|them) down|never (?:get|got) round to|been putting (?:it|this) off|been avoiding|been telling myself|cant seem to|can'?t seem to|cant bring myself|been failing to|been struggling to)\b/i;

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
    ANY_SHOULD_RE.test(m.content) &&
    m.content.length >= 20 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no shoulds detected in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`SHOULD CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting SHOULD statements — moments where the user typed an unmet self-mandate. 'I should ___', 'I ought to ___', 'I need to ___', 'I have to ___', 'I'm supposed to ___', 'I gotta ___', 'I must ___'. Each statement is an obligation the user feels but hasn't yet committed to (committed actions go into the promises register, not here). Across many messages these stack into a structural inventory of UNMET OBLIGATIONS — the things the user keeps telling themselves they ought to do or be.",
    "",
    "The novel insight you must capture: WHOSE voice put this should there. The same surface form 'I should call my mum more' might be the user's own voice (a chosen value), or their mum's voice internalised, or a social norm absorbed without inspection. Naming the source is what turns this from a guilt-list into a self-authorship exercise.",
    "",
    "Eight kinds. Pick the BEST fit:",
    "  moral       — about character or being. 'i should be more patient', 'i shouldn't be so harsh'.",
    "  practical   — about chores, errands, admin. 'i should sort that drawer', 'i need to fix the door', 'i should reply to that email'.",
    "  social      — about reaching out / staying in touch. 'i should call her', 'i should text him back', 'i need to catch up with X'.",
    "  relational  — about how the user shows up in close relationships. 'i should be more present with my partner', 'i should listen more to my mum', 'i should apologise to him'.",
    "  health      — about body / sleep / food / movement / substance use. 'i should eat better', 'i should stop drinking', 'i need to go to bed earlier', 'i should see a doctor'.",
    "  identity    — about being a 'kind of person'. 'i should be the kind of person who...', 'i ought to be more disciplined', 'i should be someone who'.",
    "  work        — about work tasks / output / professionalism. 'i should reply to that client', 'i need to finish the deck', 'i should ship that PR'.",
    "  financial   — about money. 'i should save more', 'i need to stop spending on takeaways', 'i should cancel that subscription'.",
    "",
    "Eight obligation sources. Pick the BEST fit by reading the surrounding context — who's the imagined judge of this obligation?",
    "  self                — the user's own values. They have OWNED this. 'i value being someone who shows up; i should call her' = self.",
    "  parent              — a parent/elder voice. 'mum always said you should...', 'my dad would say' OR if the surrounding context (preceding messages in the dump) shows the user is using the same words/standards their parent did. Includes 'in-laws', grandparents.",
    "  partner             — the user's romantic partner. 'she's been on at me about', 'he keeps saying i should'.",
    "  inner_critic        — the user's own self-critical voice that the user has not endorsed. Marked by guilt-saturation, dismissiveness, self-pathologising tone. 'i'm a bad son if i don't', 'i'm so lazy, i should'.",
    "  social_norm         — generic society. 'most people would', 'people my age', 'you're supposed to', 'isn't that what you do at 30'.",
    "  professional_norm   — work / industry / craft norms. 'a serious founder would', 'real engineers', 'the standard playbook says'.",
    "  financial_judge     — money-shame / pinching voice. 'i shouldn't have spent that on a coffee', 'i need to be more frugal' (when not domain=health/etc). Surfaces around any spending guilt.",
    "  abstract_other      — generic 'should' with no specific audience identifiable. Default ONLY if none of the others fit.",
    "",
    "Output strict JSON ONLY:",
    `{"shoulds": [{"should_text":"...", "should_kind":"...", "distilled_obligation":"...", "obligation_source":"...", "charge_score": 1-5, "domain":"...", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- should_text: VERBATIM 'I should ___' phrase (or ought-to, need-to, have-to). <=160 chars. Include enough of the sentence to make it readable.",
    "- should_kind: ONE of moral | practical | social | relational | health | identity | work | financial.",
    "- distilled_obligation: the unmet thing the user is saying they ought to do, distilled. <=240 chars. Examples: 'i really should call my mum more, it's been weeks' -> 'call mum more often'. 'i need to stop spending on takeaways, it's getting out of hand' -> 'stop spending on takeaways'. 'i should be more present with my partner' -> 'be more present with my partner'. British English. Don't repeat the verbatim phrase — distil it.",
    "- obligation_source: ONE of self | parent | partner | inner_critic | social_norm | professional_norm | financial_judge | abstract_other. Read the message AND nearby messages for clues. If unsure, pick abstract_other.",
    "- charge_score: 1-5. 1=casual mention, no charge ('i should grab milk'). 2=mild ('i really should sort that out'). 3=clear obligation, neutral tone ('i need to call her'). 4=guilt-tinged ('i feel bad, i should have called her by now'). 5=guilt-saturated, repeated, self-pathologising ('i'm a terrible son, i should be calling her every week, i can't believe i haven't').",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other.",
    "- confidence: 1-5 (5=clearly an unmet obligation, 1=likely throwaway phrasing or a present-tense reasoning verb).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- Reasoning verbs in present tense — 'i should think about that' (not an obligation, a reasoning move). 'i should consider' likewise.",
    "- 'I should have' — past-tense regret, not present-tense obligation. (That belongs in a different register.)",
    "- 'You should' addressed at the assistant or someone else — only first-person.",
    "- 'I had to' as past-tense narration of what already happened ('i had to leave early yesterday').",
    "- Same should twice across nearby messages — pick the cleanest first occurrence with highest charge_score.",
    "- Things that are already clearly committed promises (i.e. the user states a specific deadline / first step in the same message). Those go to the promises register.",
    "",
    "The litmus test: is the user typing 'I should ___ / ought to / need to / have to' about something they have NOT yet committed to doing? If yes, capture it. The diagnostic value is in the obligation_source naming — that's what makes this a structural inventory rather than a todo list.",
    "",
    "British English. No em-dashes. Don't invent shoulds that aren't in the messages. Quality over quantity. If borderline, emit with confidence=2 so the user sees it.",
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

  let parsed: { shoulds?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.shoulds)) {
    return NextResponse.json({ error: "model output missing shoulds array" }, { status: 502 });
  }

  type ParsedS = {
    should_text?: unknown;
    should_kind?: unknown;
    distilled_obligation?: unknown;
    obligation_source?: unknown;
    charge_score?: unknown;
    domain?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidS = {
    should_text: string;
    should_kind: string;
    distilled_obligation: string;
    obligation_source: string;
    charge_score: number;
    domain: string;
    confidence: number;
    spoken_date: string;
    message_id: string;
    conversation_id: string | null;
  };

  const valid: ValidS[] = [];
  for (const s of parsed.shoulds as ParsedS[]) {
    const text = typeof s.should_text === "string" ? s.should_text.trim().slice(0, 200) : "";
    const kind = typeof s.should_kind === "string" && VALID_KINDS.has(s.should_kind) ? s.should_kind : null;
    const distilledRaw = typeof s.distilled_obligation === "string" ? s.distilled_obligation.trim() : "";
    const distilled = distilledRaw.length >= 3 ? distilledRaw.slice(0, 320) : null;
    const source = typeof s.obligation_source === "string" && VALID_SOURCES.has(s.obligation_source) ? s.obligation_source : null;
    const charge = typeof s.charge_score === "number" ? Math.max(1, Math.min(5, Math.round(s.charge_score))) : 2;
    const domain = typeof s.domain === "string" && VALID_DOMAINS.has(s.domain) ? s.domain : null;
    const confidence = typeof s.confidence === "number" ? Math.max(1, Math.min(5, Math.round(s.confidence))) : 3;
    const msgId = typeof s.msg_id === "string" ? s.msg_id.trim() : "";

    if (!kind || !source || !domain || !distilled) continue;
    if (text.length < 3) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      should_text: text,
      should_kind: kind,
      distilled_obligation: distilled,
      obligation_source: source,
      charge_score: charge,
      domain,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      message_id: msgId,
      conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying shoulds detected", latency_ms: Date.now() - t0 });
  }

  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("shoulds")
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
    should_text: string;
    should_kind: string;
    distilled_obligation: string;
    obligation_source: string;
    charge_score: number;
    domain: string;
    spoken_date: string;
    spoken_message_id: string;
    spoken_conversation_id: string | null;
    recurrence_count: number;
    recurrence_days: number;
    recurrence_with_charge: number;
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

    const reKind = KIND_RE[c.should_kind];

    let recurrenceCount = 1;
    const recurrenceDays = new Set<string>([c.spoken_date]);
    let recurrenceWithCharge = c.charge_score >= 4 ? 1 : 0;
    const samples: SampleRow[] = [];
    const spokenMs = new Date(c.spoken_date + "T12:00:00.000Z").getTime();

    if (reKind) {
      for (const m of userMessages) {
        if (m.id === c.message_id) continue;
        const idx = m.content.search(reKind);
        if (idx < 0) continue;
        recurrenceCount += 1;
        recurrenceDays.add(dateOnly(m.created_at));
        if (CHARGE_RE.test(m.content)) recurrenceWithCharge += 1;
        const ms = new Date(m.created_at).getTime();
        if (ms < spokenMs && samples.length < MAX_SAMPLES) {
          samples.push({ date: dateOnly(m.created_at), snippet: snippetAt(m.content, idx) });
        }
      }
    }

    samples.sort((a, b) => b.date.localeCompare(a.date));

    let patternSeverity: number;
    if (recurrenceCount >= 10 && recurrenceWithCharge >= 4) patternSeverity = 5;
    else if (recurrenceCount >= 6 && recurrenceWithCharge >= 2) patternSeverity = 4;
    else if (recurrenceCount >= 3 && (c.should_kind === "relational" || c.should_kind === "health" || c.should_kind === "identity")) patternSeverity = 3;
    else if (recurrenceCount >= 3) patternSeverity = 2;
    else patternSeverity = 1;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      should_text: c.should_text,
      should_kind: c.should_kind,
      distilled_obligation: c.distilled_obligation,
      obligation_source: c.obligation_source,
      charge_score: c.charge_score,
      domain: c.domain,
      spoken_date: c.spoken_date,
      spoken_message_id: c.message_id,
      spoken_conversation_id: c.conversation_id,
      recurrence_count: recurrenceCount,
      recurrence_days: recurrenceDays.size,
      recurrence_with_charge: recurrenceWithCharge,
      recurrence_samples: samples,
      pattern_severity: patternSeverity,
      confidence: c.confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new shoulds to surface — everything detected was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("shoulds")
    .insert(toInsert)
    .select("id, scan_id, should_text, should_kind, distilled_obligation, obligation_source, charge_score, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_with_charge, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    shoulds: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      should_candidates: candidates.length,
      shoulds_extracted: valid.length,
    },
  });
}
