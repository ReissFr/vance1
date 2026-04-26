// POST /api/mirror-index/scan — Mirror Index (§161).
//
// Body: { window_days?: 30-365 (default 120) }
//
// Two-phase mining:
//   Phase 1 — Haiku extracts SELF-COMPARISONS the user made. Six kinds:
//     past_self / peer / sibling_or_parent / ideal_self /
//     imagined_future_self / downward. For each: comparison_text (verbatim),
//     comparison_target (1-5 word noun phrase), target_aliases (1-5),
//     self_position (below/equal/above/aspiring), fairness_score (1-5),
//     valence (lifting/neutral/punishing), domain, confidence, msg_id.
//   Phase 2 — server-side: for each comparison, walks ALL messages in the
//     window and counts how many other messages mention the same target
//     (using comparison_target + target_aliases as a whole-word regex).
//     Records up to 5 PRIOR-IN-WINDOW samples (date + snippet). Computes
//     pattern_severity from recurrence_count + below-position rate +
//     avg fairness — surfaces CHRONIC punishing comparisons that the
//     user might not see in themselves.
//
// dedup by (user_id, spoken_message_id) so re-scans don't flood.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4500;

const VALID_KINDS = new Set([
  "past_self", "peer", "sibling_or_parent", "ideal_self", "imagined_future_self", "downward",
]);
const VALID_POSITIONS = new Set(["below", "equal", "above", "aspiring"]);
const VALID_VALENCES = new Set(["lifting", "neutral", "punishing"]);
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

  // Phase 1 pre-filter: messages with comparison cues.
  const COMPARE_RE = /\b(when i was|old me|young me|i used to|back then i|the version of me|the kind of person|someone who has|someone who's|i should be|i want to be|i want to become|i'm not the kind of person|i'm the kind of person|like (?:my (?:brother|sister|dad|mum|mom|father|mother|cousin|friend)|him|her)|my (?:brother|sister|dad|mum|mom|father|mother|cousin|friend) (?:has|did|built|made|earned|earns|got|owns|runs)|everyone (?:else )?(?:seems|has|is|gets|already|all)|other (?:founders|people|guys|girls|men|women|developers|artists)|at my age|by (?:my age|now i should|30|40)|at least i'?m not|at least i'?m better than|imagine being|compared to|next to (?:him|her|them|my)|while (?:he|she|they) (?:were|are|have)|i'm so far behind|i'?m way behind|i'?m behind|catch up to|ahead of me|miles ahead|already (?:has|have|made|built|done)|i should have|by now i|by 30 i|by 40 i|i imagined i'd be|i thought i'd be)\b/i;

  const candidates = userMessages.filter((m) =>
    COMPARE_RE.test(m.content) &&
    m.content.length >= 30 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no self-comparisons found in this window", latency_ms: Date.now() - t0 });
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
  lines.push(`COMPARISON-LIKE CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting SELF-COMPARISONS — moments where the user compared themselves (explicitly or by direct implication) to someone or something. Six kinds:",
    "",
    "  past_self            — 'when I was 25', 'old me', 'I used to', 'back then I'. The user vs a previous version of themselves.",
    "  peer                 — 'X has a startup and 3 kids', 'everyone else seems to have figured it out', 'other founders my age'. The user vs friends/peers/strangers.",
    "  sibling_or_parent    — 'my brother built X by 30', 'my dad would have', 'my mum at my age was already'. The user vs a family member.",
    "  ideal_self           — 'I should be the kind of person who', 'someone who has it together would', 'I'm not the kind of person who'. The user vs an idealised version of themselves.",
    "  imagined_future_self — 'I want to be the kind of person who', 'the me in 5 years', 'I imagined I'd be'. The user vs a hoped-for future self (subtly different from ideal — future is positioned in time, ideal is a-temporal).",
    "  downward             — 'at least I'm not', 'imagine being them', 'could be worse'. The user comparing themselves favourably DOWNWARD to someone worse off.",
    "",
    "Output strict JSON ONLY:",
    `{"comparisons": [{"comparison_text":"...", "comparison_kind":"...", "comparison_target":"...", "target_aliases":["..."], "self_position":"...", "fairness_score": 1-5, "valence":"...", "domain":"...", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- comparison_text: VERBATIM from the message. <=240 chars. The sentence containing the comparison.",
    "- comparison_kind: ONE of past_self | peer | sibling_or_parent | ideal_self | imagined_future_self | downward.",
    "- comparison_target: 1-5 word noun phrase identifying who/what the user compared themselves to. Examples: 'my brother', 'old me at 23', 'founders my age', 'the version of me who exercises', 'my dad in his 40s', 'people on Twitter'. SPECIFIC enough that subsequent mentions can be matched (don't use 'them' or 'people' as the target).",
    "- target_aliases: 1-5 aliases the user might use for the same target. For 'my brother': ['brother', 'my older brother', 'him']. For 'founders my age': ['other founders', 'founders', 'people my age', 'guys my age']. SPECIFIC enough not to false-match generic words.",
    "- self_position: WHERE the user is positioning themselves relative to the comparison.",
    "    below = user places themselves beneath ('he's so far ahead of me', 'I'm not where I thought I'd be')",
    "    equal = user reads as roughly matched (rare)",
    "    above = user reads as ahead (rare; mostly for downward comparisons)",
    "    aspiring = user is REACHING toward the target ('I want to be like X', 'I'm working toward becoming the kind of person who')",
    "    Pick the closest. Not every comparison is a put-down — aspiring is positive, downward can be either neutral or punishing.",
    "- fairness_score: 1-5. How fair is THIS comparison?",
    "    5 = fair, honest accounting that acknowledges differences in starting points / circumstances / luck / timing",
    "    4 = mostly fair, small distortions",
    "    3 = neutral / hard to tell",
    "    2 = unfair, ignores major asymmetries (different starting capital / different industry / different decade)",
    "    1 = cruel, distorted comparison in service of self-criticism (comparing to a 35-year-old peak when user is starting; comparing to someone with vastly different resources)",
    "- valence: lifting (comparison ends with motivation/grace/curiosity), neutral (factual), punishing (ends with self-attack — 'I'm so behind', 'I'm worthless next to him').",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other.",
    "- confidence: 1-5 (5=clearly a comparison, 1=ambiguous between comparison and observation).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- Pure factual statements about another person without self-implicature ('Sarah just had a baby' alone is not a comparison)",
    "- Comparisons of objects/products/projects ('my old code was sharper than this' — that's about code not self)",
    "- Operational comparisons ('this version is faster than that version')",
    "- Self-talk that doesn't compare ('I'm tired today' is not a comparison; 'I used to be more energetic' IS a past_self comparison)",
    "- Same comparison twice across messages — pick the cleanest first occurrence",
    "",
    "Be careful with imagined_future_self vs ideal_self: imagined_future_self is positioned in time (the version of me who has done X by year Y); ideal_self is a-temporal (the kind of person who handles things calmly).",
    "",
    "Be honest about fairness_score. If the user is comparing themselves to someone with totally different circumstances, that's a 1 or 2. If they're acknowledging the asymmetry while still doing the comparison, that's 4 or 5. The point is to surface the unfair ones.",
    "",
    "British English. No em-dashes. Don't invent comparisons that aren't in the messages. Quality over quantity.",
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

  let parsed: { comparisons?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.comparisons)) {
    return NextResponse.json({ error: "model output missing comparisons array" }, { status: 502 });
  }

  type ParsedC = {
    comparison_text?: unknown;
    comparison_kind?: unknown;
    comparison_target?: unknown;
    target_aliases?: unknown;
    self_position?: unknown;
    fairness_score?: unknown;
    valence?: unknown;
    domain?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidC = {
    comparison_text: string;
    comparison_kind: string;
    comparison_target: string;
    target_aliases: string[];
    self_position: string;
    fairness_score: number;
    valence: string;
    domain: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    spoken_conversation_id: string | null;
  };

  const valid: ValidC[] = [];
  for (const c of parsed.comparisons as ParsedC[]) {
    const text = typeof c.comparison_text === "string" ? c.comparison_text.trim().slice(0, 320) : "";
    const kind = typeof c.comparison_kind === "string" && VALID_KINDS.has(c.comparison_kind) ? c.comparison_kind : null;
    const target = typeof c.comparison_target === "string" ? c.comparison_target.trim().slice(0, 80) : "";
    const aliasesRaw = Array.isArray(c.target_aliases) ? c.target_aliases : [];
    const aliases = aliasesRaw
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().slice(0, 60))
      .filter((a) => a.length >= 2)
      .slice(0, 5);
    const position = typeof c.self_position === "string" && VALID_POSITIONS.has(c.self_position) ? c.self_position : null;
    const fairness = typeof c.fairness_score === "number" ? Math.max(1, Math.min(5, Math.round(c.fairness_score))) : 3;
    const valence = typeof c.valence === "string" && VALID_VALENCES.has(c.valence) ? c.valence : null;
    const domain = typeof c.domain === "string" && VALID_DOMAINS.has(c.domain) ? c.domain : null;
    const confidence = typeof c.confidence === "number" ? Math.max(1, Math.min(5, Math.round(c.confidence))) : 3;
    const msgId = typeof c.msg_id === "string" ? c.msg_id.trim() : "";

    if (!kind || !position || !valence || !domain) continue;
    if (text.length < 8 || target.length < 2) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    valid.push({
      comparison_text: text,
      comparison_kind: kind,
      comparison_target: target,
      target_aliases: aliases,
      self_position: position,
      fairness_score: fairness,
      valence,
      domain,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      spoken_conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying self-comparisons detected", latency_ms: Date.now() - t0 });
  }

  // Phase 2: for each comparison, walk all user messages in the window and count
  // OTHER messages mentioning the same target. We use the comparison_target +
  // target_aliases as a whole-word case-insensitive regex.

  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("mirror_comparisons")
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
    comparison_text: string;
    comparison_kind: string;
    comparison_target: string;
    target_aliases: string[];
    self_position: string;
    fairness_score: number;
    valence: string;
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

    const reTarget = buildRegex([c.comparison_target, ...c.target_aliases]);

    let recurrenceCount = 1;
    const recurrenceDays = new Set<string>([c.spoken_date]);
    const samples: SampleRow[] = [];
    const spokenMs = new Date(c.spoken_date + "T12:00:00.000Z").getTime();

    if (reTarget) {
      for (const m of userMessages) {
        if (m.id === c.spoken_message_id) continue;
        const idx = m.content.search(reTarget);
        if (idx < 0) continue;
        recurrenceCount += 1;
        recurrenceDays.add(dateOnly(m.created_at));
        const ms = new Date(m.created_at).getTime();
        if (ms < spokenMs && samples.length < MAX_SAMPLES) {
          samples.push({ date: dateOnly(m.created_at), snippet: snippetAt(m.content, idx) });
        }
      }
    }

    samples.sort((a, b) => b.date.localeCompare(a.date));

    // pattern_severity heuristic
    let patternSeverity: number;
    const punishingShape = c.self_position === "below" && (c.valence === "punishing" || c.fairness_score <= 2);
    if (recurrenceCount >= 10 && punishingShape) patternSeverity = 5;
    else if (recurrenceCount >= 6 && punishingShape) patternSeverity = 4;
    else if (recurrenceCount >= 3 && c.valence === "punishing") patternSeverity = 3;
    else if (recurrenceCount >= 3) patternSeverity = 2;
    else patternSeverity = 1;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      comparison_text: c.comparison_text,
      comparison_kind: c.comparison_kind,
      comparison_target: c.comparison_target,
      target_aliases: c.target_aliases,
      self_position: c.self_position,
      fairness_score: c.fairness_score,
      valence: c.valence,
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
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new self-comparisons to surface — everything detected was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("mirror_comparisons")
    .insert(toInsert)
    .select("id, scan_id, comparison_text, comparison_kind, comparison_target, target_aliases, self_position, fairness_score, valence, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    comparisons: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      comparison_candidates: candidates.length,
      comparisons_extracted: valid.length,
    },
  });
}
