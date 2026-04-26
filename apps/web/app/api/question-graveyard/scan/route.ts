// POST /api/question-graveyard/scan — Question Graveyard (§160).
//
// Body: { window_days?: 30-365 (default 180) }
//
// Two-phase mining:
//   Phase 1 — Haiku extracts QUESTIONS the user asked themselves: question
//     text, kind (decision/self_inquiry/meta/factual/hypothetical/rhetorical),
//     domain, topic_aliases, needs_answer, confidence. msg_id back-pointer.
//   Phase 2 — server-side: for each question, walk subsequent messages.
//     Look for two signals: (a) "answer markers" near the topic_aliases
//     ("I've decided", "I'll", "the answer is", "going with", "I chose")
//     to flag potential answers, recording up to 3 sample excerpts.
//     (b) re-asks of the same question (a similar question on the same
//     topic) — counts asked_again_count.
//   The Graveyard verdict: if no answer markers found, the question is
//   UNANSWERED and lives in the graveyard with a neglect_score derived
//   from days_since_asked + question_kind importance.
//
// dedup by (user_id, asked_message_id) so re-scans don't flood.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4000;

const VALID_KINDS = new Set([
  "decision", "self_inquiry", "meta", "factual", "hypothetical", "rhetorical",
]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

const IMPORTANT_KINDS = new Set(["decision", "self_inquiry", "meta"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(30, Math.min(365, Math.round(body.window_days ?? 180)));

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

  const QUESTION_RE = /\?/;
  const SELF_DIRECTED_RE = /\b(should i|do i|am i|why (?:do|am|can'?t|did|would) i|what (?:should|am|do|if) i|how (?:do|should|can|am|would) i|when (?:do|should|did) i|where (?:do|am|did) i|is it (?:the case|just me|worth)|am i (?:the (?:kind|sort)|even|really|just|missing|wrong))\b/i;
  const candidates = userMessages.filter((m) =>
    QUESTION_RE.test(m.content) &&
    SELF_DIRECTED_RE.test(m.content) &&
    m.content.length >= 20 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no self-questions found in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`QUESTION-LIKE CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting SELF-DIRECTED QUESTIONS the user has asked themselves in their own messages. NOT requests to JARVIS, NOT factual lookups for an assistant, NOT operational instructions. Self-directed questions only — questions the user is asking themselves into the void about their own life, work, identity, decisions, or world.",
    "",
    "Six kinds:",
    "  decision     — 'should I keep the agency or close it', 'do I take the offer'",
    "  self_inquiry — 'why do I keep doing this', 'am I really a builder', 'why am I afraid of X'",
    "  meta         — 'what's the right way to think about this', 'what would a wiser person ask here'",
    "  factual      — 'how much runway do I actually have', 'when did I last sleep 8 hours'",
    "  hypothetical — 'what if I had said yes back then', 'what would happen if I quit tomorrow'",
    "  rhetorical   — questions that don't actually need an answer (sarcasm, exasperation: 'why is everything broken?', 'why does this always happen to me?'). Mark needs_answer=false.",
    "",
    "Output strict JSON ONLY:",
    `{"questions": [{"question_text":"...", "question_kind":"...", "needs_answer": true|false, "domain":"...", "topic_aliases":["..."], "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- question_text: VERBATIM. If a message contains multiple questions, pick the SHARPEST or split into multiple entries. Must end in '?'. <=260 chars.",
    "- question_kind: ONE of decision | self_inquiry | meta | factual | hypothetical | rhetorical. Pick the closest match.",
    "- needs_answer: true for everything except rhetorical. Be conservative — many questions that look rhetorical are actually self-inquiry.",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other.",
    "- topic_aliases: 1-5 noun phrases the user might use later when answering or re-asking the question. Examples: for 'should I keep the agency or close it' -> ['agency', 'agency project', 'the agency', 'close the agency', 'keep the agency']. For 'why do I keep starting projects I don't finish' -> ['starting projects', 'finishing projects', 'unfinished projects', 'I keep starting']. SPECIFIC enough not to false-match generic words.",
    "- confidence: 1-5 (5=clearly a self-directed question, 1=ambiguous between self-question and request).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- Questions to JARVIS / requests for the assistant ('can you draft X for me?', 'what's the weather?')",
    "- Questions about another person, not the user themselves ('why did Sarah do X?' — unless followed by self-reflection)",
    "- Trivial operational questions ('where's the file?', 'what time is it?')",
    "- Same question twice across multiple sampled messages — pick the cleanest first occurrence",
    "- Questions where the user is clearly answering it themselves in the same message (those are not unanswered)",
    "",
    "British English. No em-dashes. Be honest. Don't invent questions that aren't in the messages. Quality over quantity — 3 sharp self-questions beat 15 vague ones.",
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

  let parsed: { questions?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.questions)) {
    return NextResponse.json({ error: "model output missing questions array" }, { status: 502 });
  }

  type ParsedQ = {
    question_text?: unknown;
    question_kind?: unknown;
    needs_answer?: unknown;
    domain?: unknown;
    topic_aliases?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidQ = {
    question_text: string;
    question_kind: string;
    needs_answer: boolean;
    domain: string;
    topic_aliases: string[];
    confidence: number;
    asked_date: string;
    asked_message_id: string;
    asked_conversation_id: string | null;
  };

  const valid: ValidQ[] = [];
  for (const q of parsed.questions as ParsedQ[]) {
    const questionText = typeof q.question_text === "string" ? q.question_text.trim().slice(0, 320) : "";
    const questionKind = typeof q.question_kind === "string" && VALID_KINDS.has(q.question_kind) ? q.question_kind : null;
    const needsAnswer = typeof q.needs_answer === "boolean" ? q.needs_answer : (questionKind !== "rhetorical");
    const domain = typeof q.domain === "string" && VALID_DOMAINS.has(q.domain) ? q.domain : null;
    const aliasesRaw = Array.isArray(q.topic_aliases) ? q.topic_aliases : [];
    const aliases = aliasesRaw
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().slice(0, 60))
      .filter((a) => a.length >= 2)
      .slice(0, 5);
    const confidence = typeof q.confidence === "number" ? Math.max(1, Math.min(5, Math.round(q.confidence))) : 3;
    const msgId = typeof q.msg_id === "string" ? q.msg_id.trim() : "";

    if (!questionKind || !domain || questionText.length < 6) continue;
    if (!questionText.includes("?")) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      question_text: questionText,
      question_kind: questionKind,
      needs_answer: needsAnswer,
      domain,
      topic_aliases: aliases,
      confidence,
      asked_date: msgDates.get(msgId) as string,
      asked_message_id: msgId,
      asked_conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying self-questions detected", latency_ms: Date.now() - t0 });
  }

  // Phase 2: for each question, walk subsequent messages and look for ANSWER MARKERS
  // near the topic_aliases. Also count asked_again_count (re-asks of the same topic).
  // Only the user's own messages count for answers (not assistant) — answers are
  // commitments / decisions / realisations the user made.

  const ANSWER_MARKER_RE = /\b(i'?ve decided|i decided|i'?ll|i'?m going to|i'?ll go with|i'?m going with|going with|the answer is|i think (?:it'?s|the answer)|after thinking|on reflection,? (?:i|the)|i realise|i realize|i now think|my answer is|here'?s what i'?m doing|i'?m choosing|i chose|i chose to|in the end|finally,? i|i'?ve concluded|i'?ve worked out|i'?ve figured out|the choice is|i'?m settling on|i'?m landing on|i'?ve landed on|landed on|i'?m committing to|committed to)\b/i;

  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("question_graveyard")
    .select("asked_message_id")
    .eq("user_id", user.id)
    .gte("created_at", yearAgoIso);
  const existingMsgIds = new Set(
    ((existingRows ?? []) as Array<{ asked_message_id: string | null }>)
      .map((r) => r.asked_message_id)
      .filter((s): s is string => typeof s === "string"),
  );

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;
  const todayMs = Date.now();

  type SampleRow = { date: string; snippet: string };

  type Insert = {
    user_id: string;
    scan_id: string;
    question_text: string;
    question_kind: string;
    needs_answer: boolean;
    domain: string;
    asked_date: string;
    asked_message_id: string;
    asked_conversation_id: string | null;
    topic_aliases: string[];
    days_since_asked: number;
    asked_again_count: number;
    asked_again_days: number;
    answered: boolean;
    answer_text: string | null;
    answer_date: string | null;
    answer_message_id: string | null;
    days_to_answer: number | null;
    proposed_answer_excerpts: SampleRow[];
    neglect_score: number;
    confidence: number;
    latency_ms: number;
    model: string;
  };

  const toInsert: Insert[] = [];
  const MAX_SAMPLES = 3;

  function buildRegex(terms: string[]): RegExp | null {
    const filtered = terms.filter((t) => t.length >= 2);
    if (filtered.length === 0) return null;
    const escaped = filtered.map(escapeRegex);
    return new RegExp(`(?<![A-Za-z])(${escaped.join("|")})(?![A-Za-z])`, "i");
  }

  function snippetAt(content: string, idx: number): string {
    const start = Math.max(0, idx - 70);
    const end = Math.min(content.length, idx + 140);
    const snip = (start > 0 ? "..." : "") + content.slice(start, end).replace(/\n+/g, " ") + (end < content.length ? "..." : "");
    return snip.slice(0, 220);
  }

  for (const q of valid) {
    if (existingMsgIds.has(q.asked_message_id)) continue;

    const askedMs = new Date(q.asked_date + "T23:59:59.999Z").getTime();
    const daysSince = Math.max(0, Math.round((todayMs - askedMs) / 86_400_000));

    const reTopic = buildRegex(q.topic_aliases);

    const proposedAnswers: SampleRow[] = [];
    let answered = false;
    let answerText: string | null = null;
    let answerDate: string | null = null;
    let answerMessageId: string | null = null;
    let askedAgainCount = 0;
    const askedAgainDays = new Set<string>();

    if (q.needs_answer && reTopic) {
      for (const m of allMessages) {
        if (m.role !== "user") continue;
        const ms = new Date(m.created_at).getTime();
        if (ms <= askedMs) continue;
        if (m.id === q.asked_message_id) continue;
        if (!reTopic.test(m.content)) continue;

        if (m.content.includes("?") && SELF_DIRECTED_RE.test(m.content)) {
          askedAgainCount += 1;
          askedAgainDays.add(dateOnly(m.created_at));
        }

        const ansIdx = m.content.search(ANSWER_MARKER_RE);
        if (ansIdx >= 0) {
          const d = dateOnly(m.created_at);
          proposedAnswers.push({ date: d, snippet: snippetAt(m.content, ansIdx) });
          if (!answered) {
            answered = true;
            answerText = snippetAt(m.content, ansIdx);
            answerDate = d;
            answerMessageId = m.id;
          }
        }
      }
    }

    const proposedSamples = proposedAnswers.slice(0, MAX_SAMPLES);

    let neglectScore: number;
    if (answered) neglectScore = 1;
    else if (!q.needs_answer) neglectScore = 1;
    else if (daysSince >= 90 && IMPORTANT_KINDS.has(q.question_kind)) neglectScore = 5;
    else if (daysSince >= 120) neglectScore = 5;
    else if (daysSince >= 60 && IMPORTANT_KINDS.has(q.question_kind)) neglectScore = 4;
    else if (daysSince >= 90) neglectScore = 4;
    else if (daysSince >= 30) neglectScore = 3;
    else if (daysSince >= 14) neglectScore = 2;
    else neglectScore = 1;

    const daysToAnswer = answered && answerDate
      ? Math.max(0, Math.round((new Date(answerDate + "T12:00:00.000Z").getTime() - askedMs) / 86_400_000))
      : null;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      question_text: q.question_text,
      question_kind: q.question_kind,
      needs_answer: q.needs_answer,
      domain: q.domain,
      asked_date: q.asked_date,
      asked_message_id: q.asked_message_id,
      asked_conversation_id: q.asked_conversation_id,
      topic_aliases: q.topic_aliases,
      days_since_asked: daysSince,
      asked_again_count: askedAgainCount,
      asked_again_days: askedAgainDays.size,
      answered,
      answer_text: answerText,
      answer_date: answerDate,
      answer_message_id: answerMessageId,
      days_to_answer: daysToAnswer,
      proposed_answer_excerpts: proposedSamples,
      neglect_score: neglectScore,
      confidence: q.confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new self-questions to bury — everything detected was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("question_graveyard")
    .insert(toInsert)
    .select("id, scan_id, question_text, question_kind, needs_answer, domain, asked_date, asked_message_id, asked_conversation_id, topic_aliases, days_since_asked, asked_again_count, asked_again_days, answered, answer_text, answer_date, answer_message_id, days_to_answer, proposed_answer_excerpts, neglect_score, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    questions: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      question_candidates: candidates.length,
      questions_extracted: valid.length,
    },
  });
}
