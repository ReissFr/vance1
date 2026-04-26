// GET /api/reconcile/journal — Reality Reconciliation.
//
// Compares "what you said you'd do" (intentions, decisions, predictions,
// goals, commitments, themes, policies) against "what you actually did"
// (wins, standups, checkins, reflections, habit_logs, focus_sessions).
// Surfaces drift signals — places where stated intent and observed
// behaviour disagree.
//
// Drift kinds returned:
//   - intention_unmatched: an intention with no echo in same-day standup/wins
//   - decision_silent: a decision logged >7d ago with no follow-up signal
//   - goal_stalled: active goal, target_date approaching, no recent wins
//   - prediction_overdue: open prediction whose resolve_by has passed
//   - commitment_overdue: open outbound commitment whose deadline has passed
//   - habit_missed: habit target_per_week not met in the trailing 7 days
//   - focus_underperformed: focus session where actual < 50% of planned
//   - theme_dormant: active theme not updated in 14d AND no recent wins tagged
//
// No new table — purely SQL fan-out + word-overlap matching in JS.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Severity = "high" | "medium" | "low";

type Signal = {
  kind:
    | "intention_unmatched"
    | "decision_silent"
    | "goal_stalled"
    | "prediction_overdue"
    | "commitment_overdue"
    | "habit_missed"
    | "focus_underperformed"
    | "theme_dormant";
  severity: Severity;
  said: { id: string; text: string; date: string; href: string };
  did: { id: string; text: string; date: string; href: string } | null;
  gap_days?: number;
  note?: string;
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "will", "your",
  "you", "are", "was", "but", "not", "all", "any", "can", "has", "had", "more",
  "than", "into", "out", "off", "its", "their", "they", "them", "our", "ours",
  "what", "when", "where", "which", "who", "how", "why", "did", "does", "doing",
  "done", "make", "made", "take", "took", "get", "got", "want", "wants", "need",
  "needs", "going", "able", "about", "after", "again", "also", "only", "very",
  "just", "like", "some", "such", "today", "tomorrow", "yesterday", "week",
  "month", "year", "day", "days", "weeks", "months", "years", "still", "would",
  "could", "should", "might", "must", "been", "being", "were", "really",
  "thing", "things", "stuff", "got", "lot", "lots", "much", "many",
]);

function tokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function parseWindow(raw: string | null): number {
  if (raw === "7d") return 7;
  if (raw === "90d") return 90;
  return 30;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const windowDays = parseWindow(url.searchParams.get("window"));
  const today = new Date();
  const todayIso = today.toISOString();
  const todayDate = todayIso.slice(0, 10);
  const windowStart = new Date(today.getTime() - windowDays * 86_400_000);
  const windowStartIso = windowStart.toISOString();
  const windowStartDate = windowStartIso.slice(0, 10);

  const [
    intentionsRes,
    decisionsRes,
    goalsRes,
    predictionsRes,
    commitmentsRes,
    habitsRes,
    habitLogsRes,
    focusRes,
    themesRes,
    winsRes,
    standupsRes,
    reflectionsRes,
  ] = await Promise.all([
    supabase
      .from("intentions")
      .select("id, log_date, text, completed_at")
      .eq("user_id", user.id)
      .gte("log_date", windowStartDate)
      .lte("log_date", todayDate)
      .order("log_date", { ascending: false })
      .limit(200),
    supabase
      .from("decisions")
      .select("id, title, choice, expected_outcome, context, created_at")
      .eq("user_id", user.id)
      .gte("created_at", windowStartIso)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("goals")
      .select("id, title, why, target_date, progress_pct, status, milestones, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(200),
    supabase
      .from("predictions")
      .select("id, claim, confidence, resolve_by, status")
      .eq("user_id", user.id)
      .eq("status", "open")
      .lt("resolve_by", todayDate)
      .limit(200),
    supabase
      .from("commitments")
      .select("id, commitment_text, direction, deadline, status, other_party")
      .eq("user_id", user.id)
      .eq("direction", "outbound")
      .eq("status", "open")
      .not("deadline", "is", null)
      .lt("deadline", todayIso)
      .limit(200),
    supabase
      .from("habits")
      .select("id, name, cadence, target_per_week")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .limit(200),
    supabase
      .from("habit_logs")
      .select("habit_id, log_date")
      .eq("user_id", user.id)
      .gte("log_date", windowStartDate),
    supabase
      .from("focus_sessions")
      .select("id, started_at, planned_seconds, actual_seconds, topic, completed_fully")
      .eq("user_id", user.id)
      .gte("started_at", windowStartIso)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(200),
    supabase
      .from("themes")
      .select("id, title, current_state, kind, status, tags, updated_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(100),
    supabase
      .from("wins")
      .select("id, text, kind, created_at")
      .eq("user_id", user.id)
      .gte("created_at", windowStartIso)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("standups")
      .select("id, log_date, yesterday, today, blockers")
      .eq("user_id", user.id)
      .gte("log_date", windowStartDate)
      .lte("log_date", todayDate)
      .order("log_date", { ascending: false })
      .limit(200),
    supabase
      .from("reflections")
      .select("id, text, kind, tags, created_at")
      .eq("user_id", user.id)
      .gte("created_at", windowStartIso)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const wins = (winsRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>;
  const standups = (standupsRes.data ?? []) as Array<{ id: string; log_date: string; yesterday: string | null; today: string | null; blockers: string | null }>;
  const reflections = (reflectionsRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; tags: string[] | null; created_at: string }>;

  const winTokens = wins.map((w) => ({ row: w, tok: tokens(w.text) }));
  const standupTokens = standups.map((s) => ({
    row: s,
    tok: tokens([s.yesterday, s.today, s.blockers].filter(Boolean).join(" ")),
  }));
  const reflectionTokens = reflections.map((r) => ({ row: r, tok: tokens(r.text) }));

  const signals: Signal[] = [];

  // --- intention_unmatched: intention text has no overlap with same-day or
  //     next-day standup or any win within 2d of the intention.
  const intentions = (intentionsRes.data ?? []) as Array<{ id: string; log_date: string; text: string; completed_at: string | null }>;
  for (const it of intentions) {
    if (it.completed_at) continue;
    const itTok = tokens(it.text);
    if (itTok.size < 2) continue;
    const itDate = new Date(it.log_date + "T00:00:00Z");
    let bestDid: Signal["did"] = null;
    let bestScore = 0;
    for (const s of standupTokens) {
      const gap = Math.abs(daysBetween(new Date(s.row.log_date + "T00:00:00Z"), itDate));
      if (gap > 1) continue;
      const score = overlap(itTok, s.tok);
      if (score > bestScore) {
        bestScore = score;
        bestDid = { id: s.row.id, text: [s.row.today, s.row.yesterday].filter(Boolean).join(" — ") || "(empty standup)", date: s.row.log_date, href: "/standups" };
      }
    }
    for (const w of winTokens) {
      const gap = Math.abs(daysBetween(new Date(w.row.created_at), itDate));
      if (gap > 2) continue;
      const score = overlap(itTok, w.tok);
      if (score > bestScore) {
        bestScore = score;
        bestDid = { id: w.row.id, text: w.row.text, date: w.row.created_at.slice(0, 10), href: "/wins" };
      }
    }
    if (bestScore >= 2) continue;
    const ageDays = daysBetween(today, itDate);
    if (ageDays < 1) continue;
    signals.push({
      kind: "intention_unmatched",
      severity: ageDays > 7 ? "high" : ageDays > 3 ? "medium" : "low",
      said: { id: it.id, text: it.text, date: it.log_date, href: "/intentions" },
      did: null,
      gap_days: ageDays,
      note: "no win or standup line on or near that day mentions this",
    });
  }

  // --- decision_silent: decision logged >7d ago, no win/reflection/standup
  //     in the window has any 2-word overlap with the choice or outcome.
  const decisions = (decisionsRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; expected_outcome: string | null; context: string | null; created_at: string }>;
  for (const d of decisions) {
    const ageDays = daysBetween(today, new Date(d.created_at));
    if (ageDays < 7) continue;
    const dTok = tokens([d.title, d.choice, d.expected_outcome].filter(Boolean).join(" "));
    if (dTok.size < 2) continue;
    let echo = false;
    for (const w of winTokens) {
      if (overlap(dTok, w.tok) >= 2) { echo = true; break; }
    }
    if (!echo) {
      for (const r of reflectionTokens) {
        if (overlap(dTok, r.tok) >= 2) { echo = true; break; }
      }
    }
    if (!echo) {
      for (const s of standupTokens) {
        if (overlap(dTok, s.tok) >= 2) { echo = true; break; }
      }
    }
    if (echo) continue;
    signals.push({
      kind: "decision_silent",
      severity: ageDays > 30 ? "high" : ageDays > 14 ? "medium" : "low",
      said: { id: d.id, text: d.title + (d.choice ? " — " + d.choice : ""), date: d.created_at.slice(0, 10), href: "/decisions" },
      did: null,
      gap_days: ageDays,
      note: "no win, reflection or standup since mentions this decision",
    });
  }

  // --- goal_stalled: active goal, no win in window mentions title or why.
  type GoalRow = { id: string; title: string; why: string | null; target_date: string | null; progress_pct: number | null; status: string; milestones: unknown; created_at: string };
  const goals = (goalsRes.data ?? []) as GoalRow[];
  for (const g of goals) {
    const gTok = tokens([g.title, g.why].filter(Boolean).join(" "));
    if (gTok.size < 2) continue;
    let recentEcho: typeof winTokens[number] | null = null;
    for (const w of winTokens) {
      if (overlap(gTok, w.tok) >= 2) { recentEcho = w; break; }
    }
    if (recentEcho) continue;
    let urgency: Severity = "low";
    let gap = windowDays;
    if (g.target_date) {
      const td = new Date(g.target_date + "T00:00:00Z");
      const daysToTarget = daysBetween(td, today);
      if (daysToTarget < 14) urgency = "high";
      else if (daysToTarget < 45) urgency = "medium";
      gap = Math.max(0, daysToTarget);
    }
    signals.push({
      kind: "goal_stalled",
      severity: urgency,
      said: { id: g.id, text: g.title + (g.target_date ? ` · target ${g.target_date}` : ""), date: g.created_at.slice(0, 10), href: "/goals" },
      did: null,
      gap_days: gap,
      note: g.target_date ? `target ${g.target_date}, no recent win mentions it` : "no recent win mentions it",
    });
  }

  // --- prediction_overdue: open predictions past resolve_by.
  const overdue = (predictionsRes.data ?? []) as Array<{ id: string; claim: string; confidence: number; resolve_by: string; status: string }>;
  for (const p of overdue) {
    const days = daysBetween(today, new Date(p.resolve_by + "T00:00:00Z"));
    signals.push({
      kind: "prediction_overdue",
      severity: days > 14 ? "high" : days > 3 ? "medium" : "low",
      said: { id: p.id, text: `${p.claim} · ${p.confidence}%`, date: p.resolve_by, href: "/predictions" },
      did: null,
      gap_days: days,
      note: "resolve verdict to keep calibration honest",
    });
  }

  // --- commitment_overdue: outbound open commitments past deadline.
  const cmts = (commitmentsRes.data ?? []) as Array<{ id: string; commitment_text: string; direction: string; deadline: string; status: string; other_party: string }>;
  for (const c of cmts) {
    const days = daysBetween(today, new Date(c.deadline));
    signals.push({
      kind: "commitment_overdue",
      severity: days > 14 ? "high" : days > 3 ? "medium" : "low",
      said: { id: c.id, text: `${c.commitment_text} · to ${c.other_party}`, date: c.deadline.slice(0, 10), href: "/today" },
      did: null,
      gap_days: days,
      note: "you said you would; mark done, push, or withdraw",
    });
  }

  // --- habit_missed: trailing 7-day count below target_per_week.
  const habits = (habitsRes.data ?? []) as Array<{ id: string; name: string; cadence: string; target_per_week: number }>;
  const habitLogs = (habitLogsRes.data ?? []) as Array<{ habit_id: string; log_date: string }>;
  const trailing7Start = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const countByHabit = new Map<string, number>();
  for (const log of habitLogs) {
    if (log.log_date < trailing7Start) continue;
    countByHabit.set(log.habit_id, (countByHabit.get(log.habit_id) ?? 0) + 1);
  }
  for (const h of habits) {
    const got = countByHabit.get(h.id) ?? 0;
    if (got >= h.target_per_week) continue;
    const shortfall = h.target_per_week - got;
    signals.push({
      kind: "habit_missed",
      severity: shortfall >= h.target_per_week ? "high" : shortfall >= Math.ceil(h.target_per_week / 2) ? "medium" : "low",
      said: { id: h.id, text: `${h.name} · target ${h.target_per_week}/wk`, date: trailing7Start, href: "/habits" },
      did: { id: h.id, text: `${got}/${h.target_per_week} this week`, date: todayDate, href: "/habits" },
      gap_days: 7,
      note: `${shortfall} short of weekly target`,
    });
  }

  // --- focus_underperformed: actual < 50% of planned.
  const focuses = (focusRes.data ?? []) as Array<{ id: string; started_at: string; planned_seconds: number; actual_seconds: number | null; topic: string | null; completed_fully: boolean | null }>;
  for (const f of focuses) {
    if (!f.actual_seconds || !f.planned_seconds) continue;
    const ratio = f.actual_seconds / f.planned_seconds;
    if (ratio >= 0.5) continue;
    const plannedMin = Math.round(f.planned_seconds / 60);
    const actualMin = Math.round(f.actual_seconds / 60);
    signals.push({
      kind: "focus_underperformed",
      severity: ratio < 0.25 ? "high" : "medium",
      said: { id: f.id, text: `${f.topic ?? "focus"} · planned ${plannedMin}m`, date: f.started_at.slice(0, 10), href: "/focus" },
      did: { id: f.id, text: `actual ${actualMin}m (${Math.round(ratio * 100)}%)`, date: f.started_at.slice(0, 10), href: "/focus" },
      note: "planned deeper than you went",
    });
  }

  // --- theme_dormant: active theme with no recent win/reflection echo.
  const themes = (themesRes.data ?? []) as Array<{ id: string; title: string; current_state: string | null; kind: string; status: string; tags: string[] | null; updated_at: string }>;
  for (const t of themes) {
    const tTok = tokens([t.title, t.current_state].filter(Boolean).join(" "));
    if (tTok.size < 2) continue;
    let echo = false;
    for (const w of winTokens) {
      if (overlap(tTok, w.tok) >= 2) { echo = true; break; }
    }
    if (!echo) {
      for (const r of reflectionTokens) {
        if (overlap(tTok, r.tok) >= 2) { echo = true; break; }
      }
    }
    if (echo) continue;
    const ageDays = daysBetween(today, new Date(t.updated_at));
    if (ageDays < 14) continue;
    signals.push({
      kind: "theme_dormant",
      severity: ageDays > 60 ? "high" : ageDays > 30 ? "medium" : "low",
      said: { id: t.id, text: `${t.title} · ${t.kind}`, date: t.updated_at.slice(0, 10), href: "/themes" },
      did: null,
      gap_days: ageDays,
      note: "no recent win or reflection picks this up",
    });
  }

  const severityRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  signals.sort((a, b) => {
    const s = severityRank[a.severity] - severityRank[b.severity];
    if (s !== 0) return s;
    return (b.gap_days ?? 0) - (a.gap_days ?? 0);
  });

  const byKind: Record<string, number> = {};
  for (const s of signals) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;

  const totalSaid =
    intentions.length + decisions.length + goals.length + overdue.length +
    cmts.length + habits.length + focuses.length + themes.length;

  return NextResponse.json({
    window_days: windowDays,
    total_signals: signals.length,
    total_said: totalSaid,
    by_kind: byKind,
    signals,
  });
}
