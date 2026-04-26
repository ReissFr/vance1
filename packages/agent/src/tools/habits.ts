// Brain-level habits tools. Read the list, log today's check-in, and query
// streak/week stats for a specific habit. Kept narrow — create/archive live
// in the /habits UI, not over WhatsApp.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { defineTool } from "./types";

type HabitRow = {
  id: string;
  name: string;
  cadence: "daily" | "weekly";
  target_per_week: number;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week < 10 ? "0" : ""}${week}`;
}

async function findHabit(
  supabase: SupabaseClient,
  userId: string,
  nameOrId: string,
): Promise<HabitRow | null> {
  // Try id first (accepts full uuid).
  if (/^[0-9a-f-]{32,40}$/i.test(nameOrId)) {
    const { data } = await supabase
      .from("habits")
      .select("id, name, cadence, target_per_week")
      .eq("user_id", userId)
      .eq("id", nameOrId)
      .is("archived_at", null)
      .maybeSingle();
    if (data) return data as HabitRow;
  }
  const { data } = await supabase
    .from("habits")
    .select("id, name, cadence, target_per_week")
    .eq("user_id", userId)
    .is("archived_at", null)
    .ilike("name", `%${nameOrId}%`)
    .limit(1);
  return (data?.[0] as HabitRow | undefined) ?? null;
}

export const listHabitsTool = defineTool({
  name: "list_habits",
  description: [
    "List the user's active habits with streak + today-status.",
    "",
    "Use when the user asks: 'what habits am I tracking?', 'how's my streak?',",
    "'did I work out yesterday?', 'missed any habits today?'.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const { data: habits, error } = await ctx.supabase
      .from("habits")
      .select("id, name, cadence, target_per_week, sort_order")
      .eq("user_id", ctx.userId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(`Failed to load habits: ${error.message}`);
    const list = (habits ?? []) as HabitRow[];
    if (list.length === 0) {
      return {
        count: 0,
        habits: [],
        hint: "User has no habits set up. Tell them they can add one at /habits.",
      };
    }

    const since = new Date();
    since.setDate(since.getDate() - 40);
    const { data: logs } = await ctx.supabase
      .from("habit_logs")
      .select("habit_id, log_date")
      .eq("user_id", ctx.userId)
      .in(
        "habit_id",
        list.map((h) => h.id),
      )
      .gte("log_date", ymd(since));
    const logsByHabit = new Map<string, Set<string>>();
    for (const l of (logs ?? []) as { habit_id: string; log_date: string }[]) {
      if (!logsByHabit.has(l.habit_id)) logsByHabit.set(l.habit_id, new Set());
      logsByHabit.get(l.habit_id)!.add(l.log_date);
    }

    const today = new Date();
    const todayStr = ymd(today);
    const week = isoWeekKey(today);
    const rows = list.map((h) => {
      const set = logsByHabit.get(h.id) ?? new Set<string>();
      let streak = 0;
      if (h.cadence === "daily") {
        const cursor = new Date(today);
        while (set.has(ymd(cursor))) {
          streak += 1;
          cursor.setDate(cursor.getDate() - 1);
        }
      }
      let weekCount = 0;
      for (const s of set) {
        if (isoWeekKey(new Date(s)) === week) weekCount += 1;
      }
      return {
        id: h.id,
        name: h.name,
        cadence: h.cadence,
        target_per_week: h.target_per_week,
        done_today: set.has(todayStr),
        streak,
        week_count: weekCount,
      };
    });

    const missedToday = rows.filter((r) => !r.done_today && r.cadence === "daily");
    return {
      count: rows.length,
      habits: rows,
      missed_today_daily: missedToday.map((r) => r.name),
    };
  },
});

export const logHabitTool = defineTool({
  name: "log_habit",
  description: [
    "Mark a habit as done for today. Idempotent — logging the same habit",
    "twice in a day doesn't create a duplicate entry.",
    "",
    "Accepts either the habit name (case-insensitive substring) or its id.",
    "",
    "Use when the user says: 'log my workout', 'I read today', 'did the gym'.",
  ].join("\n"),
  schema: z.object({
    habit: z.string().min(1).describe("Habit name (substring) or id."),
  }),
  inputSchema: {
    type: "object",
    required: ["habit"],
    properties: {
      habit: {
        type: "string",
        description: "Habit name (case-insensitive substring) or id.",
      },
    },
  },
  async run(input, ctx) {
    const h = await findHabit(ctx.supabase, ctx.userId, input.habit);
    if (!h) {
      return {
        ok: false,
        error: `No habit matching "${input.habit}". Ask the user to check the /habits page.`,
      };
    }
    const today = ymd(new Date());
    const { data: existing } = await ctx.supabase
      .from("habit_logs")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("habit_id", h.id)
      .eq("log_date", today)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        already_logged: true,
        habit: h.name,
        date: today,
      };
    }
    const { error } = await ctx.supabase.from("habit_logs").insert({
      user_id: ctx.userId,
      habit_id: h.id,
      log_date: today,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, habit: h.name, date: today };
  },
});

export const habitStreakTool = defineTool({
  name: "habit_streak",
  description: [
    "Get the current streak + recent history for one habit. Useful when the",
    "user asks about a specific habit ('how long have I been reading?').",
  ].join("\n"),
  schema: z.object({
    habit: z.string().min(1).describe("Habit name (substring) or id."),
  }),
  inputSchema: {
    type: "object",
    required: ["habit"],
    properties: {
      habit: {
        type: "string",
        description: "Habit name (case-insensitive substring) or id.",
      },
    },
  },
  async run(input, ctx) {
    const h = await findHabit(ctx.supabase, ctx.userId, input.habit);
    if (!h) {
      return { ok: false, error: `No habit matching "${input.habit}".` };
    }
    const since = new Date();
    since.setDate(since.getDate() - 40);
    const { data: logs } = await ctx.supabase
      .from("habit_logs")
      .select("log_date")
      .eq("user_id", ctx.userId)
      .eq("habit_id", h.id)
      .gte("log_date", ymd(since))
      .order("log_date", { ascending: false });
    const set = new Set<string>(
      ((logs ?? []) as { log_date: string }[]).map((l) => l.log_date),
    );

    const today = new Date();
    const todayStr = ymd(today);
    let streak = 0;
    const cursor = new Date(today);
    while (set.has(ymd(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    const last14 = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (13 - i));
      const s = ymd(d);
      return { date: s, done: set.has(s) };
    });
    const week = isoWeekKey(today);
    let weekCount = 0;
    for (const s of set) if (isoWeekKey(new Date(s)) === week) weekCount += 1;

    return {
      ok: true,
      habit: h.name,
      cadence: h.cadence,
      target_per_week: h.target_per_week,
      streak,
      done_today: set.has(todayStr),
      week_count: weekCount,
      last_14_days: last14,
    };
  },
});
