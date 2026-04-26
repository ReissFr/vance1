// Brain-level focus / deep-work tools. Read-only — sessions are started
// from the /focus UI, not over WhatsApp.

import { z } from "zod";
import { defineTool } from "./types";

type SessionRow = {
  started_at: string;
  actual_seconds: number | null;
  topic: string | null;
  planned_seconds: number;
  completed_fully: boolean;
};

function ymdUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

export const focusStatsTool = defineTool({
  name: "focus_stats",
  description: [
    "Report the user's deep-work/focus stats from the /focus timer.",
    "",
    "Use when the user asks: 'how much deep work did I do this week?',",
    "'did I focus today?', 'what's my focus streak?', 'best focus day'.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data, error } = await ctx.supabase
      .from("focus_sessions")
      .select("started_at, actual_seconds, topic, planned_seconds, completed_fully")
      .eq("user_id", ctx.userId)
      .gte("started_at", since.toISOString())
      .order("started_at", { ascending: false });
    if (error) throw new Error(`Failed to load focus sessions: ${error.message}`);
    const rows = (data ?? []) as SessionRow[];

    if (rows.length === 0) {
      return {
        total_sessions_30d: 0,
        week_minutes: 0,
        today_minutes: 0,
        hint: "No focus sessions logged. Tell the user they can start one at /focus.",
      };
    }

    const today = new Date();
    const todayKey = ymdUTC(today);
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    weekStart.setUTCHours(0, 0, 0, 0);

    let weekMinutes = 0;
    let todayMinutes = 0;
    const byDay = new Map<string, number>();
    let completed = 0;
    let bailed = 0;
    for (const s of rows) {
      const secs = s.actual_seconds ?? 0;
      if (secs <= 0) continue;
      const dt = new Date(s.started_at);
      const mins = Math.round(secs / 60);
      const key = ymdUTC(dt);
      byDay.set(key, (byDay.get(key) ?? 0) + mins);
      if (dt >= weekStart) weekMinutes += mins;
      if (key === todayKey) todayMinutes += mins;
      if (s.completed_fully) completed += 1;
      else bailed += 1;
    }

    // Longest run of consecutive days with > 0 focus minutes, ending today or earlier.
    let longest = 0;
    let cursor = new Date(today);
    let current = 0;
    for (let i = 0; i < 30; i += 1) {
      const key = ymdUTC(cursor);
      if ((byDay.get(key) ?? 0) > 0) {
        current += 1;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    let bestDay: { date: string; minutes: number } | null = null;
    for (const [k, v] of byDay) {
      if (!bestDay || v > bestDay.minutes) bestDay = { date: k, minutes: v };
    }

    const lastSession = rows[0];
    return {
      total_sessions_30d: rows.length,
      completed_sessions_30d: completed,
      bailed_sessions_30d: bailed,
      week_minutes: weekMinutes,
      today_minutes: todayMinutes,
      best_day_30d: bestDay,
      longest_streak_days: longest,
      last_session: lastSession
        ? {
            started_at: lastSession.started_at,
            planned_minutes: Math.round(lastSession.planned_seconds / 60),
            actual_minutes: lastSession.actual_seconds
              ? Math.round(lastSession.actual_seconds / 60)
              : null,
            completed_fully: lastSession.completed_fully,
            topic: lastSession.topic,
          }
        : null,
    };
  },
});
