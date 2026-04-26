// POST /api/patterns/scan — scan the user's logged data for cause-effect
// patterns and surface them as one-sentence statements with quantified
// support.
//
// Body: { window_days?: 30-365 (default 120), domain_focus?: 'energy'|'mood'|'focus'|'time'|'decisions'|'relationships'|'work'|'habits'|'money'|'mixed' }
//
// Pulls daily_checkins (energy/mood/focus per day), standups (with timestamps
// of created_at to detect "late nights"), intentions (with completion), wins
// (with kinds + magnitudes), reflections, decisions, habit_logs, blockers
// (from standups), and computes a handful of quantitative seed signals
// server-side: weekday concentration of wins, energy-following-late-standup,
// mood-decisions-reversal, intention-completion-by-checkin-score,
// blocker-recurrence — then dumps both the raw data and the seed signals into
// Haiku and asks for 0-6 patterns. Each pattern is a one-sentence statement
// with antecedent / consequent / examples / strength.
//
// Patterns are not deduped against past scans (the pattern can deepen as new
// data lands and we want to see the calibration shift). Re-running gives a
// fresh snapshot.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2400;

const VALID_RELATIONS = new Set(["correlation", "sequence", "cluster", "threshold", "compound"]);
const VALID_DOMAINS = new Set(["energy", "mood", "focus", "time", "decisions", "relationships", "work", "habits", "money", "mixed"]);
const VALID_DIRECTIONS = new Set(["positive", "negative", "neither"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }
function dayOfWeek(d: string): string { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(d + "T12:00:00Z").getUTCDay()] ?? "?"; }
function pct(n: number, d: number): string { return d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`; }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number; domain_focus?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(30, Math.min(365, Math.round(body.window_days ?? 120)));
  const domainFocus = typeof body.domain_focus === "string" && VALID_DOMAINS.has(body.domain_focus) ? body.domain_focus : null;

  const t0 = Date.now();
  const now = Date.now();
  const startIso = new Date(now - windowDays * 86_400_000).toISOString();
  const startDate = dateOnly(startIso);
  const todayDate = dateOnly(new Date().toISOString());

  const [
    checkinsRes,
    standupsRes,
    intentionsRes,
    decisionsRes,
    reflectionsRes,
    winsRes,
    habitsRes,
    habitLogsRes,
  ] = await Promise.all([
    supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", user.id).gte("log_date", startDate).order("log_date", { ascending: true }).limit(400),
    supabase.from("standups").select("log_date, today, blockers, yesterday, created_at").eq("user_id", user.id).gte("log_date", startDate).order("log_date", { ascending: true }).limit(400),
    supabase.from("intentions").select("log_date, text, completed_at").eq("user_id", user.id).gte("log_date", startDate).order("log_date", { ascending: true }).limit(400),
    supabase.from("decisions").select("id, title, choice, tags, created_at").eq("user_id", user.id).gte("created_at", startIso).order("created_at", { ascending: false }).limit(80),
    supabase.from("reflections").select("text, kind, tags, created_at").eq("user_id", user.id).gte("created_at", startIso).order("created_at", { ascending: false }).limit(60),
    supabase.from("wins").select("text, kind, amount_cents, created_at").eq("user_id", user.id).gte("created_at", startIso).order("created_at", { ascending: false }).limit(120),
    supabase.from("habits").select("id, name, cadence").eq("user_id", user.id).is("archived_at", null).limit(40),
    supabase.from("habit_logs").select("habit_id, log_date").eq("user_id", user.id).gte("log_date", startDate).limit(800),
  ]);

  const checkins = (checkinsRes.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
  const standups = (standupsRes.data ?? []) as Array<{ log_date: string; today: string | null; blockers: string | null; yesterday: string | null; created_at: string }>;
  const intentions = (intentionsRes.data ?? []) as Array<{ log_date: string; text: string; completed_at: string | null }>;
  const decisions = (decisionsRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; tags: string[] | null; created_at: string }>;
  const reflections = (reflectionsRes.data ?? []) as Array<{ text: string; kind: string; tags: string[] | null; created_at: string }>;
  const wins = (winsRes.data ?? []) as Array<{ text: string; kind: string; amount_cents: number | null; created_at: string }>;
  const habits = (habitsRes.data ?? []) as Array<{ id: string; name: string; cadence: string }>;
  const habitLogs = (habitLogsRes.data ?? []) as Array<{ habit_id: string; log_date: string }>;

  const totalEvidence = checkins.length + standups.length + intentions.length + decisions.length + reflections.length + wins.length + habitLogs.length;
  if (totalEvidence < 30) {
    return NextResponse.json({ error: "not enough activity in the window to scan for patterns yet — log a few weeks of journal entries, check-ins, or wins first" }, { status: 400 });
  }

  // Seed signal #1: weekday concentration of wins
  const winsByDow = new Map<string, number>();
  for (const w of wins) {
    const dow = dayOfWeek(dateOnly(w.created_at));
    winsByDow.set(dow, (winsByDow.get(dow) ?? 0) + 1);
  }
  const winsByDowSorted = Array.from(winsByDow.entries()).sort((a, b) => b[1] - a[1]);

  // Seed signal #2: energy following late standups (created_at > 22:00 local-ish — we use UTC slice)
  // Late = standup.created_at hour >= 22
  const checkinsByDate = new Map<string, { energy: number | null; mood: number | null; focus: number | null }>();
  for (const c of checkins) checkinsByDate.set(c.log_date, { energy: c.energy, mood: c.mood, focus: c.focus });

  type LateCase = { standup_date: string; created_hour: number; next_day_energy: number | null };
  const lateCases: LateCase[] = [];
  for (const s of standups) {
    const created = new Date(s.created_at);
    const hour = created.getUTCHours();
    if (hour >= 22 || hour <= 2) {
      const nextDay = new Date(s.log_date + "T12:00:00Z");
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const nextDate = dateOnly(nextDay.toISOString());
      const next = checkinsByDate.get(nextDate);
      lateCases.push({ standup_date: s.log_date, created_hour: hour, next_day_energy: next?.energy ?? null });
    }
  }
  const lateWithEnergy = lateCases.filter((c) => c.next_day_energy != null);
  const lateLowEnergy = lateWithEnergy.filter((c) => (c.next_day_energy ?? 5) <= 2).length;

  // Seed signal #3: decisions logged on low-mood days, reversed within 4 weeks (proxy: tagged 'reversed' or 'reverted' OR appears in later reflection text matching the title)
  type DecCase = { title: string; created_at: string; same_day_mood: number | null; reversed_signal: boolean };
  const decCases: DecCase[] = [];
  const reflectionsText = reflections.map((r) => (r.text ?? "").toLowerCase()).join("\n");
  for (const d of decisions) {
    const date = dateOnly(d.created_at);
    const c = checkinsByDate.get(date);
    const titleSnip = (d.title ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 2).join(" ");
    const reversedTagged = (d.tags ?? []).some((t) => /reversed|reverted|undone|abandoned|changed-mind/i.test(t));
    const reversedNarrative = titleSnip.length > 3 && /reversed|backed out|changed my mind|undid|undone|abandoned|reverted/i.test(reflectionsText) && reflectionsText.includes(titleSnip);
    decCases.push({ title: d.title, created_at: d.created_at, same_day_mood: c?.mood ?? null, reversed_signal: reversedTagged || reversedNarrative });
  }
  const lowMoodDecs = decCases.filter((d) => d.same_day_mood != null && d.same_day_mood <= 2);
  const lowMoodReversed = lowMoodDecs.filter((d) => d.reversed_signal).length;
  const highMoodDecs = decCases.filter((d) => d.same_day_mood != null && d.same_day_mood >= 4);
  const highMoodReversed = highMoodDecs.filter((d) => d.reversed_signal).length;

  // Seed signal #4: intention completion by check-in score
  const intentionsByDate = new Map<string, { completed: boolean }>();
  for (const i of intentions) intentionsByDate.set(i.log_date, { completed: i.completed_at != null });
  const completionByEnergyBucket = new Map<string, { total: number; done: number }>();
  for (const c of checkins) {
    const intent = intentionsByDate.get(c.log_date);
    if (!intent || c.energy == null) continue;
    const bucket = c.energy >= 4 ? "high (4-5)" : c.energy <= 2 ? "low (1-2)" : "mid (3)";
    const cur = completionByEnergyBucket.get(bucket) ?? { total: 0, done: 0 };
    cur.total += 1; if (intent.completed) cur.done += 1;
    completionByEnergyBucket.set(bucket, cur);
  }

  // Seed signal #5: blocker recurrence — extract first 3 noun-ish words from each non-empty blockers field, count repeats
  const blockerTokens = new Map<string, number>();
  for (const s of standups) {
    if (!s.blockers) continue;
    const tokens = s.blockers.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    const unique = new Set(tokens);
    for (const t of unique) blockerTokens.set(t, (blockerTokens.get(t) ?? 0) + 1);
  }
  const stopwords = new Set(["with","this","that","than","from","have","need","into","want","just","like","over","still","when","what","while","because","really","cannot","would","could","being","there","their","about","onto","upon","every","much","more","also","none"]);
  const recurringBlockers = Array.from(blockerTokens.entries()).filter(([t, n]) => n >= 3 && !stopwords.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Seed signal #6: habit logging concentration by weekday
  const habitLogsByDow = new Map<string, number>();
  for (const l of habitLogs) {
    const dow = dayOfWeek(l.log_date);
    habitLogsByDow.set(dow, (habitLogsByDow.get(dow) ?? 0) + 1);
  }
  const habitLogsByDowSorted = Array.from(habitLogsByDow.entries()).sort((a, b) => b[1] - a[1]);

  // Seed signal #7: avg checkin scores by weekday
  const checkinByDow: Record<string, { energySum: number; energyCount: number; moodSum: number; moodCount: number }> = {};
  for (const c of checkins) {
    const dow = dayOfWeek(c.log_date);
    if (!checkinByDow[dow]) checkinByDow[dow] = { energySum: 0, energyCount: 0, moodSum: 0, moodCount: 0 };
    if (c.energy != null) { checkinByDow[dow].energySum += c.energy; checkinByDow[dow].energyCount += 1; }
    if (c.mood != null) { checkinByDow[dow].moodSum += c.mood; checkinByDow[dow].moodCount += 1; }
  }

  // Build evidence dump
  const lines: string[] = [];
  lines.push(`WINDOW: ${startDate} → ${todayDate} (${windowDays} days)`);
  if (domainFocus) lines.push(`DOMAIN FOCUS: ${domainFocus}`);
  lines.push("");

  lines.push(`COUNTS: ${checkins.length} check-ins · ${standups.length} standups · ${intentions.length} intentions · ${decisions.length} decisions · ${reflections.length} reflections · ${wins.length} wins · ${habitLogs.length} habit-logs across ${habits.length} habits`);
  lines.push("");

  // Seed signals block
  lines.push("SEED SIGNALS (server-computed, treat as ground truth):");
  lines.push("");

  if (winsByDowSorted.length) {
    const top = winsByDowSorted[0];
    if (top) {
      const total = wins.length;
      lines.push(`- WINS-BY-WEEKDAY: ${top[0]} ${top[1]}/${total} (${pct(top[1], total)}); full distribution: ${winsByDowSorted.map(([d, n]) => `${d}=${n}`).join(", ")}`);
    }
  }

  if (lateWithEnergy.length >= 3) {
    lines.push(`- LATE-STANDUP→NEXT-DAY-ENERGY: ${lateLowEnergy}/${lateWithEnergy.length} late standups (created at hour ≥22 or ≤2 UTC) were followed by a next-day energy ≤2 (${pct(lateLowEnergy, lateWithEnergy.length)})`);
  }

  if (lowMoodDecs.length >= 3) {
    lines.push(`- LOW-MOOD-DECISIONS: ${lowMoodReversed}/${lowMoodDecs.length} decisions logged on a low-mood day (mood ≤2) show a reversal signal (${pct(lowMoodReversed, lowMoodDecs.length)}); compare ${highMoodReversed}/${highMoodDecs.length} on high-mood days (${pct(highMoodReversed, Math.max(1, highMoodDecs.length))})`);
  }

  if (completionByEnergyBucket.size) {
    const parts: string[] = [];
    for (const [bucket, agg] of completionByEnergyBucket.entries()) {
      parts.push(`${bucket} energy → ${agg.done}/${agg.total} intentions done (${pct(agg.done, agg.total)})`);
    }
    lines.push(`- INTENTION-COMPLETION-BY-ENERGY: ${parts.join("; ")}`);
  }

  if (recurringBlockers.length) {
    lines.push(`- RECURRING BLOCKER WORDS (>=3 distinct days): ${recurringBlockers.map(([t, n]) => `${t}×${n}`).join(", ")}`);
  }

  if (habitLogsByDowSorted.length) {
    const top = habitLogsByDowSorted[0];
    if (top) {
      lines.push(`- HABIT-LOGGING-BY-WEEKDAY: ${top[0]} ${top[1]}; full: ${habitLogsByDowSorted.map(([d, n]) => `${d}=${n}`).join(", ")}`);
    }
  }

  const dows = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const cidParts: string[] = [];
  for (const d of dows) {
    const a = checkinByDow[d];
    if (a && a.energyCount >= 2) {
      const avgE = (a.energySum / a.energyCount).toFixed(1);
      cidParts.push(`${d}=${avgE}`);
    }
  }
  if (cidParts.length >= 3) lines.push(`- AVG ENERGY BY WEEKDAY: ${cidParts.join(", ")}`);

  lines.push("");

  // Sample slices of raw data
  if (checkins.length) {
    lines.push("RECENT CHECK-INS (last 14):");
    for (const c of checkins.slice(-14)) lines.push(`- ${c.log_date} energy=${c.energy ?? "-"} mood=${c.mood ?? "-"} focus=${c.focus ?? "-"}${c.note ? " — " + c.note.slice(0, 80) : ""}`);
    lines.push("");
  }

  if (intentions.length) {
    lines.push("RECENT INTENTIONS + COMPLETION (last 14):");
    for (const i of intentions.slice(-14)) lines.push(`- ${i.log_date} ${i.completed_at ? "[done]" : "[open]"} ${i.text.slice(0, 100)}`);
    lines.push("");
  }

  if (decisions.length) {
    lines.push(`RECENT DECISIONS (sample of ${Math.min(decisions.length, 12)}):`);
    for (const d of decisions.slice(0, 12)) lines.push(`- ${dateOnly(d.created_at)} ${d.title}${d.choice ? " — " + d.choice.slice(0, 80) : ""}${(d.tags ?? []).length ? ` [${(d.tags ?? []).join(",")}]` : ""}`);
    lines.push("");
  }

  if (reflections.length) {
    lines.push(`RECENT REFLECTIONS (sample of ${Math.min(reflections.length, 10)}):`);
    for (const r of reflections.slice(0, 10)) lines.push(`- ${dateOnly(r.created_at)} [${r.kind}] ${r.text.slice(0, 160)}`);
    lines.push("");
  }

  if (wins.length) {
    lines.push(`RECENT WINS (sample of ${Math.min(wins.length, 12)}):`);
    for (const w of wins.slice(0, 12)) lines.push(`- ${dateOnly(w.created_at)} [${w.kind}] ${w.text.slice(0, 100)}`);
    lines.push("");
  }

  if (standups.length) {
    lines.push(`RECENT BLOCKERS (last 8 non-empty):`);
    let count = 0;
    for (const s of [...standups].reverse()) {
      if (!s.blockers) continue;
      lines.push(`- ${s.log_date} ${s.blockers.slice(0, 120)}`);
      count += 1;
      if (count >= 8) break;
    }
    lines.push("");
  }

  const focusLine = domainFocus ? `If a domain focus is requested (${domainFocus}), bias your patterns toward that domain — but don't fabricate signal where the data is thin. If the data doesn't support that domain, return fewer patterns.` : "";

  const system = [
    "You are detecting CAUSAL PATTERNS in the user's own logged data — links between event types where one tends to precede or co-occur with another, with quantified support. The user lives inside these patterns without seeing them. Your job is to NAME them.",
    "",
    "Output strict JSON ONLY:",
    `{"patterns": [{"relation_kind": "...", "antecedent": "...", "consequent": "...", "statement": "...", "nuance": "...", "domain": "...", "direction": "...", "lift": null, "support_count": null, "total_count": null, "strength": 1-5, "source_signal": "...", "examples": [{"date":"YYYY-MM-DD","antecedent_evidence":"...","consequent_evidence":"..."}], "candidate_intervention": null}, ...]}`,
    "",
    "Rules:",
    "- Return 0-6 patterns. ZERO is fine. Don't pad. Only surface patterns that are actually load-bearing — a single coincidence isn't a pattern, ≥3 supporting cases is the floor.",
    "- relation_kind: one of correlation | sequence | cluster | threshold | compound. SEQUENCE means A precedes B in time. CLUSTER means A co-occurs with X/Y/Z. THRESHOLD means A above some level predicts B. COMPOUND means the combination of two signals predicts B. CORRELATION is the catch-all.",
    "- antecedent: 4-12 words, present-tense observable description (e.g. 'Standup logged after 23:00', 'Decision logged on a low-mood day', 'Wins clustering on Tuesday-Wednesday'). The TRIGGER side.",
    "- consequent: 4-12 words, present-tense observable (e.g. 'Next-day energy drops below 3', 'Decision is reversed within 4 weeks', 'No wins logged on Monday'). The OUTCOME side.",
    "- statement: ONE sentence in second-person voice meant to LAND. 'When you log a standup after 23:00, your next-day energy drops below 3 in 4 of 5 cases.' This is the line the user reads. Specific. No hedging.",
    "- nuance: ONE optional sentence — counterexample, caveat, or context. Empty string if not needed. e.g. 'But this only applies when you also haven't logged a check-in that day.'",
    "- domain: one of energy | mood | focus | time | decisions | relationships | work | habits | money | mixed.",
    "- direction: positive (A increases B), negative (A decreases B), or neither (categorical co-occurrence).",
    "- lift: numeric 0.0-9.99 if you can compute it from the seed signals (e.g. lift 2.4 = the consequent is 2.4× more likely after the antecedent than baseline). NULL if you can't justify a number.",
    "- support_count: integer count of supporting cases (e.g. 11). NULL if narrative-only.",
    "- total_count: integer denominator (e.g. 14). NULL if narrative-only. support_count must be ≤ total_count when both set.",
    "- strength: 1-5. 5 = ironclad (≥80% support, ≥8 cases, surprising); 4 = strong; 3 = noticeable; 2 = weak signal; 1 = noise-floor curiosity.",
    "- source_signal: name the data feed(s) producing it (e.g. 'standups+daily_checkins', 'wins+weekday', 'decisions+daily_checkins+reflections', 'standups_blockers').",
    "- examples: 2-5 dated examples, each with antecedent_evidence (one phrase quoting/paraphrasing the antecedent for that date) and consequent_evidence (one phrase). Pull dates from the data above. NO MADE-UP DATES.",
    "- candidate_intervention: ONE optional second-person sentence framing a lever the user could pull or not pull (e.g. 'If you want fewer reversed decisions, try sleeping on any decision logged on a mood-≤2 day.'). NULL if no clean lever.",
    "",
    "DO NOT fabricate examples. Pull dates from the EVIDENCE block above.",
    "DO NOT moralise. Don't suggest the user 'should' or 'shouldn't' do something — just NAME the pattern. The intervention is offered, not recommended.",
    "DO NOT invent statistical numbers. If you state '11 of 14', it must come from the seed signals or be directly countable from the data dump.",
    "DO NOT surface patterns the seed signals contradict.",
    focusLine,
    "",
    "Voice: British English, no em-dashes, no hedging, no clichés, no advice. Patterns are observations, not lessons.",
  ].filter(Boolean).join("\n");

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

  let parsed: { patterns?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.patterns)) {
    return NextResponse.json({ error: "model output missing patterns array" }, { status: 502 });
  }

  type Parsed = {
    relation_kind?: unknown;
    antecedent?: unknown;
    consequent?: unknown;
    statement?: unknown;
    nuance?: unknown;
    domain?: unknown;
    direction?: unknown;
    lift?: unknown;
    support_count?: unknown;
    total_count?: unknown;
    strength?: unknown;
    source_signal?: unknown;
    examples?: unknown;
    candidate_intervention?: unknown;
  };

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  type Insert = {
    user_id: string;
    scan_id: string;
    relation_kind: string;
    antecedent: string;
    consequent: string;
    statement: string;
    nuance: string | null;
    domain: string;
    direction: string;
    lift: number | null;
    support_count: number | null;
    total_count: number | null;
    strength: number;
    source_signal: string | null;
    examples: Array<{ date: string; antecedent_evidence: string; consequent_evidence: string }>;
    candidate_intervention: string | null;
    latency_ms: number;
    model: string;
  };

  const toInsert: Insert[] = [];

  for (const c of parsed.patterns as Parsed[]) {
    const relation = typeof c.relation_kind === "string" && VALID_RELATIONS.has(c.relation_kind) ? c.relation_kind : null;
    const ante = typeof c.antecedent === "string" ? c.antecedent.trim().slice(0, 200) : "";
    const cons = typeof c.consequent === "string" ? c.consequent.trim().slice(0, 200) : "";
    const stmt = typeof c.statement === "string" ? c.statement.trim().slice(0, 320) : "";
    const nuance = typeof c.nuance === "string" && c.nuance.trim() ? c.nuance.trim().slice(0, 320) : null;
    const domain = typeof c.domain === "string" && VALID_DOMAINS.has(c.domain) ? c.domain : null;
    const direction = typeof c.direction === "string" && VALID_DIRECTIONS.has(c.direction) ? c.direction : "neither";
    const lift = typeof c.lift === "number" && isFinite(c.lift) ? Math.max(0, Math.min(99.99, Math.round(c.lift * 100) / 100)) : null;
    const support = typeof c.support_count === "number" && isFinite(c.support_count) ? Math.max(0, Math.round(c.support_count)) : null;
    const total = typeof c.total_count === "number" && isFinite(c.total_count) ? Math.max(0, Math.round(c.total_count)) : null;
    const strength = typeof c.strength === "number" ? Math.max(1, Math.min(5, Math.round(c.strength))) : null;
    const signal = typeof c.source_signal === "string" ? c.source_signal.trim().slice(0, 120) : null;
    const intervention = typeof c.candidate_intervention === "string" && c.candidate_intervention.trim() ? c.candidate_intervention.trim().slice(0, 320) : null;

    if (!relation || !domain || !strength) continue;
    if (ante.length < 4 || cons.length < 4 || stmt.length < 16) continue;
    if (support != null && total != null && support > total) continue;

    const examples: Array<{ date: string; antecedent_evidence: string; consequent_evidence: string }> = [];
    if (Array.isArray(c.examples)) {
      for (const ex of c.examples) {
        if (typeof ex !== "object" || !ex) continue;
        const e = ex as { date?: unknown; antecedent_evidence?: unknown; consequent_evidence?: unknown };
        const date = typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null;
        const ae = typeof e.antecedent_evidence === "string" ? e.antecedent_evidence.trim().slice(0, 240) : "";
        const ce = typeof e.consequent_evidence === "string" ? e.consequent_evidence.trim().slice(0, 240) : "";
        if (!date || ae.length < 4 || ce.length < 4) continue;
        examples.push({ date, antecedent_evidence: ae, consequent_evidence: ce });
        if (examples.length >= 5) break;
      }
    }

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      relation_kind: relation,
      antecedent: ante,
      consequent: cons,
      statement: stmt,
      nuance,
      domain,
      direction,
      lift,
      support_count: support,
      total_count: total,
      strength,
      source_signal: signal,
      examples,
      candidate_intervention: intervention,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no patterns met the threshold this scan", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("patterns")
    .insert(toInsert)
    .select("id, scan_id, relation_kind, antecedent, consequent, statement, nuance, domain, direction, lift, support_count, total_count, strength, source_signal, examples, candidate_intervention, user_status, user_note, pinned, archived_at, resolved_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    patterns: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      late_standups_with_energy: lateWithEnergy.length,
      late_low_energy_count: lateLowEnergy,
      low_mood_decisions: lowMoodDecs.length,
      low_mood_reversed: lowMoodReversed,
      recurring_blockers: recurringBlockers.length,
    },
  });
}
