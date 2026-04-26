// POST /api/permission-ledger/scan — Permission Ledger (§162).
//
// Body: { window_days?: 30-365 (default 120) }
//
// Two-phase mining:
//   Phase 1 — Haiku extracts AUTHORISATION-SEEKINGS the user made. Five kinds:
//     explicit_permission ("is it ok if"), justification ("I should be
//     allowed to"), self_doubt ("is it bad that I"), comparison_to_norm
//     ("do most people do this"), future_excuse ("I'm probably going to
//     but"). For each: request_text (verbatim), requested_action (1-5
//     word noun phrase), action_aliases (1-5), implicit_authority
//     (the imagined disapprover), urgency_score 1-5, domain, confidence,
//     msg_id.
//   Phase 2 — server-side: for each seeking, walks ALL user messages in
//     the window and counts OTHER messages that mention the same action
//     (using requested_action + action_aliases as a whole-word regex).
//     Records up to 5 PRIOR-IN-WINDOW samples (date + snippet). Computes
//     pattern_severity from recurrence_count + same-authority share +
//     urgency — surfaces CHRONIC permission-seeking the user might not
//     see in themselves (e.g. asking 14 times across 90 days for
//     permission to take a day off).
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
  "explicit_permission", "justification", "self_doubt", "comparison_to_norm", "future_excuse",
]);
const VALID_AUTHORITIES = new Set([
  "self_judge", "partner", "parent", "professional_norm", "social_norm", "friend", "work_authority", "financial_judge", "abstract_other",
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

  // Phase 1 pre-filter: messages with permission-seeking cues.
  const PERM_RE = /\b(is it ok(?:ay)? (?:if|to)|is it alright (?:if|to)|do you think it'?s (?:ok|alright|fine) (?:if|to)|i hope it'?s not|i hope that'?s not|am i allowed to|are we allowed to|is it bad (?:that|to|if)|is it (?:weird|wrong|selfish|stupid|silly|crazy|naive) (?:that|to|if)|is this (?:weird|wrong|bad|normal|ok|allowed|stupid|silly)|i shouldn'?t (?:need to|have to)? ?but|i shouldn'?t (?:feel|want|do)|i feel (?:bad|guilty|weird) (?:about|for|that)|am i (?:wrong|bad|allowed|crazy)|i (?:think|feel) i deserve|i should be allowed to|i should get to|i'?m probably going to .{0,40}? but|i'?m gonna .{0,40}? but|do most people|do other people|is this (?:normal|standard|usual)|is it normal to|is it common to|what (?:would|will|do) (?:my|she|he|they|people|everyone|my (?:partner|wife|husband|boyfriend|girlfriend|mum|mom|dad|boss|team)) (?:think|say|feel)|would (?:she|he|they) (?:mind|be ok|hate|judge)|is that (?:ok|allowed|fine)|i'?m allowed to,? right|right\?$|is that selfish|is that lazy)\b/i;

  const candidates = userMessages.filter((m) =>
    PERM_RE.test(m.content) &&
    m.content.length >= 20 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no permission-seeking found in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`PERMISSION-SEEKING CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting AUTHORISATION-SEEKINGS — moments where the user sought permission for something they shouldn't actually need permission for. Five kinds:",
    "",
    "  explicit_permission  — direct request: 'is it ok if I take a day off', 'is it alright if I skip', 'am I allowed to', 'do you think it's ok to'.",
    "  justification        — argued case for being allowed: 'I should be allowed to', 'I deserve to', 'I shouldn't have to feel bad about', 'I shouldn't but'. The user is internally negotiating with someone.",
    "  self_doubt           — wondering if a desire/action is morally questionable: 'is it bad that I', 'is it weird that', 'is it selfish to', 'is it wrong to', 'I feel guilty about'. The seeking is hedged as an audit of self.",
    "  comparison_to_norm   — checking against the herd: 'do most people do this', 'is this normal', 'is it common to', 'is this standard'. The user is checking if they're allowed by appealing to majority behaviour.",
    "  future_excuse        — pre-emptive justification for an upcoming action: 'I'm probably going to skip the gym but', 'I'm gonna order takeaway again but'. The 'but' is the seeking — the user is asking forgiveness in advance.",
    "",
    "Output strict JSON ONLY:",
    `{"seekings": [{"request_text":"...", "request_kind":"...", "requested_action":"...", "action_aliases":["..."], "implicit_authority":"...", "urgency_score": 1-5, "domain":"...", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- request_text: VERBATIM from the message. <=240 chars. The sentence containing the seeking.",
    "- request_kind: ONE of explicit_permission | justification | self_doubt | comparison_to_norm | future_excuse.",
    "- requested_action: 1-5 word VERB-LED noun phrase identifying WHAT permission is being sought FOR. Examples: 'take a day off', 'skip the gym', 'say no to my dad', 'buy the watch', 'leave the relationship', 'eat the chocolate', 'cancel the meeting'. SPECIFIC enough that subsequent mentions can be matched (don't use 'do this' or 'rest' alone — 'take a rest day' is better).",
    "- action_aliases: 1-5 aliases the user might use for the same action. For 'take a day off': ['day off', 'rest day', 'taking the day', 'time off', 'a break']. For 'skip the gym': ['skip workout', 'miss the gym', 'not go to the gym', 'skipping training']. SPECIFIC enough not to false-match generic words.",
    "- implicit_authority: WHO is the user IMAGINING might disapprove? Pick the closest:",
    "    self_judge        = the inner critic; 'I shouldn't need permission but'; 'is it bad that I want'. No specific outside audience.",
    "    partner           = romantic partner is the imagined disapprover ('would she mind if', 'will my boyfriend hate this').",
    "    parent            = parent or family elder ('what would my dad think', 'my mum would freak').",
    "    professional_norm = 'is this allowed in my industry', 'is this what a [founder|doctor|lawyer] does', appeal to professional standards.",
    "    social_norm       = 'do most people do this', 'is this normal', appeal to general society.",
    "    friend            = peer group ('my friends would judge', 'X would think I'm lazy').",
    "    work_authority    = boss / client / team / business / job ('can I justify this to the team', 'will the business survive if I').",
    "    financial_judge   = imagined judge of how money is spent ('can I justify spending', 'is this reasonable to buy').",
    "    abstract_other    = no specific audience — generic 'is this ok' with no clear who.",
    "- urgency_score: 1-5. How charged is the seeking?",
    "    5 = very charged: repeated in same message, multiple hedges, anxious framing ('is it really really ok', 'I feel SO guilty')",
    "    4 = clearly seeking, slightly hedged",
    "    3 = mild seeking, neutral language",
    "    2 = passing seeking, almost rhetorical",
    "    1 = trace of seeking, ambiguous",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other.",
    "- confidence: 1-5 (5=clearly permission-seeking, 1=ambiguous between seeking and rhetorical question).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- Genuine information requests ('what's the policy on X', 'how much sleep is normal' — actual factual question, not seeking permission)",
    "- Asking the assistant for its preference ('what should I order' — that's delegation, not authorisation-seeking)",
    "- Operational questions about how to do something ('how do I cancel' — not 'is it ok to cancel')",
    "- Compliments seeking validation about other things ('is this email good?' — that's craft feedback, not permission)",
    "- Same seeking twice across messages — pick the cleanest first occurrence",
    "",
    "The litmus test: would a person at peace with their autonomy NEED to ask this? If 'I'm going to take Tuesday off' is the assertive form and they instead said 'is it ok if I take Tuesday off?' — that's an authorisation-seeking. Surface those.",
    "",
    "Be careful with implicit_authority. The phrasing reveals it. 'Will my wife hate me' = partner. 'Is this what a serious founder does' = professional_norm. 'Do most people' = social_norm. 'Is it bad that I want' (no specific audience) = self_judge.",
    "",
    "British English. No em-dashes. Don't invent seekings that aren't in the messages. Quality over quantity.",
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

  let parsed: { seekings?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.seekings)) {
    return NextResponse.json({ error: "model output missing seekings array" }, { status: 502 });
  }

  type ParsedS = {
    request_text?: unknown;
    request_kind?: unknown;
    requested_action?: unknown;
    action_aliases?: unknown;
    implicit_authority?: unknown;
    urgency_score?: unknown;
    domain?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidS = {
    request_text: string;
    request_kind: string;
    requested_action: string;
    action_aliases: string[];
    implicit_authority: string;
    urgency_score: number;
    domain: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    spoken_conversation_id: string | null;
  };

  const valid: ValidS[] = [];
  for (const s of parsed.seekings as ParsedS[]) {
    const text = typeof s.request_text === "string" ? s.request_text.trim().slice(0, 320) : "";
    const kind = typeof s.request_kind === "string" && VALID_KINDS.has(s.request_kind) ? s.request_kind : null;
    const action = typeof s.requested_action === "string" ? s.requested_action.trim().slice(0, 80) : "";
    const aliasesRaw = Array.isArray(s.action_aliases) ? s.action_aliases : [];
    const aliases = aliasesRaw
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().slice(0, 60))
      .filter((a) => a.length >= 2)
      .slice(0, 5);
    const authority = typeof s.implicit_authority === "string" && VALID_AUTHORITIES.has(s.implicit_authority) ? s.implicit_authority : null;
    const urgency = typeof s.urgency_score === "number" ? Math.max(1, Math.min(5, Math.round(s.urgency_score))) : 3;
    const domain = typeof s.domain === "string" && VALID_DOMAINS.has(s.domain) ? s.domain : null;
    const confidence = typeof s.confidence === "number" ? Math.max(1, Math.min(5, Math.round(s.confidence))) : 3;
    const msgId = typeof s.msg_id === "string" ? s.msg_id.trim() : "";

    if (!kind || !authority || !domain) continue;
    if (text.length < 8 || action.length < 2) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      request_text: text,
      request_kind: kind,
      requested_action: action,
      action_aliases: aliases,
      implicit_authority: authority,
      urgency_score: urgency,
      domain,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      spoken_conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying permission-seekings detected", latency_ms: Date.now() - t0 });
  }

  // Phase 2: for each seeking, walk all user messages in the window and count
  // OTHER messages mentioning the same action, and tally how many shared the
  // same implicit_authority shape (best-effort via the action regex —
  // authority is LLM-inferred so we can't redetect it here, but we count
  // recurrence on the action which is the load-bearing pattern).

  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("permission_seekings")
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
    request_text: string;
    request_kind: string;
    requested_action: string;
    action_aliases: string[];
    implicit_authority: string;
    urgency_score: number;
    domain: string;
    spoken_date: string;
    spoken_message_id: string;
    spoken_conversation_id: string | null;
    recurrence_count: number;
    recurrence_days: number;
    recurrence_samples: SampleRow[];
    pattern_severity: number;
    confidence: number;
    latency_ms: number;
    model: string;
  };

  const toInsert: Insert[] = [];
  const MAX_SAMPLES = 5;

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

  for (const c of valid) {
    if (existingMsgIds.has(c.spoken_message_id)) continue;

    const reAction = buildRegex([c.requested_action, ...c.action_aliases]);

    let recurrenceCount = 1;
    const recurrenceDays = new Set<string>([c.spoken_date]);
    let recurrenceWithSeeking = 0; // other messages mentioning the action AND containing permission-seeking phrasing
    const samples: SampleRow[] = [];
    const spokenMs = new Date(c.spoken_date + "T12:00:00.000Z").getTime();

    if (reAction) {
      for (const m of userMessages) {
        if (m.id === c.spoken_message_id) continue;
        const idx = m.content.search(reAction);
        if (idx < 0) continue;
        recurrenceCount += 1;
        recurrenceDays.add(dateOnly(m.created_at));
        if (PERM_RE.test(m.content)) recurrenceWithSeeking += 1;
        const ms = new Date(m.created_at).getTime();
        if (ms < spokenMs && samples.length < MAX_SAMPLES) {
          samples.push({ date: dateOnly(m.created_at), snippet: snippetAt(m.content, idx) });
        }
      }
    }

    samples.sort((a, b) => b.date.localeCompare(a.date));

    // pattern_severity heuristic
    let patternSeverity: number;
    const chronicShape = recurrenceWithSeeking >= 4; // multiple OTHER messages also seeking permission for this action
    if (recurrenceCount >= 10 && chronicShape) patternSeverity = 5;
    else if (recurrenceCount >= 6 && chronicShape) patternSeverity = 4;
    else if (recurrenceCount >= 3 && c.urgency_score >= 4) patternSeverity = 3;
    else if (recurrenceCount >= 3) patternSeverity = 2;
    else patternSeverity = 1;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      request_text: c.request_text,
      request_kind: c.request_kind,
      requested_action: c.requested_action,
      action_aliases: c.action_aliases,
      implicit_authority: c.implicit_authority,
      urgency_score: c.urgency_score,
      domain: c.domain,
      spoken_date: c.spoken_date,
      spoken_message_id: c.spoken_message_id,
      spoken_conversation_id: c.spoken_conversation_id,
      recurrence_count: recurrenceCount,
      recurrence_days: recurrenceDays.size,
      recurrence_samples: samples,
      pattern_severity: patternSeverity,
      confidence: c.confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new permission-seekings to surface — everything detected was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("permission_seekings")
    .insert(toInsert)
    .select("id, scan_id, request_text, request_kind, requested_action, action_aliases, implicit_authority, urgency_score, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    seekings: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      seeking_candidates: candidates.length,
      seekings_extracted: valid.length,
    },
  });
}
