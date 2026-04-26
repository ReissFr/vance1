// List + create habits. Streak + weekly-completion are computed from the
// habit_logs rows in the last 30 days — cheap enough to inline rather than
// maintain as a cached column.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Habit = {
  id: string;
  name: string;
  cadence: "daily" | "weekly";
  target_per_week: number;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
};

type LogRow = { habit_id: string; log_date: string };

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

function computeStreak(logDates: Set<string>, today: Date): number {
  let streak = 0;
  const cursor = new Date(today);
  while (logDates.has(ymd(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function isoWeekKey(d: Date): string {
  // ISO-8601 week for grouping weekly completion. Good enough: year + week.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week < 10 ? "0" : ""}${week}`;
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: habits } = await supabase
    .from("habits")
    .select("id, name, cadence, target_per_week, archived_at, sort_order, created_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const habitList = (habits ?? []) as Habit[];
  if (habitList.length === 0) {
    return NextResponse.json({ habits: [] });
  }

  const habitIds = habitList.map((h) => h.id);
  const since = new Date();
  since.setDate(since.getDate() - 40);
  const { data: logs } = await supabase
    .from("habit_logs")
    .select("habit_id, log_date")
    .eq("user_id", user.id)
    .in("habit_id", habitIds)
    .gte("log_date", ymd(since));

  const logsByHabit = new Map<string, Set<string>>();
  for (const l of (logs ?? []) as LogRow[]) {
    if (!logsByHabit.has(l.habit_id)) logsByHabit.set(l.habit_id, new Set());
    logsByHabit.get(l.habit_id)!.add(l.log_date);
  }

  const today = new Date();
  const todayStr = ymd(today);
  const currentWeek = isoWeekKey(today);

  const enriched = habitList.map((h) => {
    const set = logsByHabit.get(h.id) ?? new Set<string>();
    const streak = h.cadence === "daily" ? computeStreak(set, today) : 0;
    let weekCount = 0;
    for (const s of set) {
      const d = new Date(s);
      if (isoWeekKey(d) === currentWeek) weekCount += 1;
    }
    return {
      ...h,
      done_today: set.has(todayStr),
      streak,
      week_count: weekCount,
      // Last 14 days for a sparkline: array of { date, done }.
      recent: Array.from({ length: 14 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (13 - i));
        const s = ymd(d);
        return { date: s, done: set.has(s) };
      }),
    };
  });

  return NextResponse.json({ habits: enriched });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const cadence = body.cadence === "weekly" ? "weekly" : "daily";
  const target = Math.min(
    Math.max(
      typeof body.target_per_week === "number" ? Math.round(body.target_per_week) : 7,
      1,
    ),
    7,
  );

  const { data: existing } = await supabase
    .from("habits")
    .select("sort_order")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = existing ? ((existing.sort_order as number) ?? 0) + 1 : 0;

  const { data: inserted, error } = await supabase
    .from("habits")
    .insert({
      user_id: user.id,
      name,
      cadence,
      target_per_week: target,
      sort_order: nextSort,
    })
    .select("id, name, cadence, target_per_week, sort_order, created_at, archived_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ habit: inserted });
}
