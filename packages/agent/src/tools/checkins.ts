// Brain tools for daily check-ins. Lets the user say "log my energy as a 4"
// over WhatsApp, and lets the brain answer "how's my mood been this week?".

import { z } from "zod";
import { defineTool } from "./types";

type CheckinRow = {
  log_date: string;
  energy: number | null;
  mood: number | null;
  focus: number | null;
  note: string | null;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

function clamp(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < 1 || n > 5) return null;
  return n;
}

export const logCheckinTool = defineTool({
  name: "log_checkin",
  description: [
    "Log today's daily check-in (energy / mood / focus, each 1-5).",
    "Upserts on today's date — calling twice in one day overwrites.",
    "",
    "Use when the user says: 'log my energy 4', 'mood is 2 today',",
    "'feeling pretty focused, 5'.",
  ].join("\n"),
  schema: z.object({
    energy: z.number().int().min(1).max(5).optional(),
    mood: z.number().int().min(1).max(5).optional(),
    focus: z.number().int().min(1).max(5).optional(),
    note: z.string().max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      energy: { type: "integer", minimum: 1, maximum: 5 },
      mood: { type: "integer", minimum: 1, maximum: 5 },
      focus: { type: "integer", minimum: 1, maximum: 5 },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const today = ymd(new Date());
    const energy = clamp(input.energy);
    const mood = clamp(input.mood);
    const focus = clamp(input.focus);
    const note = input.note?.trim().slice(0, 500) || null;
    if (energy == null && mood == null && focus == null && !note) {
      return { ok: false, error: "nothing to log — provide at least one of energy/mood/focus/note" };
    }

    // Read existing row first so we only overwrite fields the user actually
    // touched (preserves earlier-in-the-day values).
    const { data: existing } = await ctx.supabase
      .from("daily_checkins")
      .select("energy, mood, focus, note")
      .eq("user_id", ctx.userId)
      .eq("log_date", today)
      .maybeSingle();
    const prev = (existing as Pick<CheckinRow, "energy" | "mood" | "focus" | "note"> | null) ?? null;

    const merged = {
      user_id: ctx.userId,
      log_date: today,
      energy: energy ?? prev?.energy ?? null,
      mood: mood ?? prev?.mood ?? null,
      focus: focus ?? prev?.focus ?? null,
      note: note ?? prev?.note ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await ctx.supabase
      .from("daily_checkins")
      .upsert(merged, { onConflict: "user_id,log_date" });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      date: today,
      energy: merged.energy,
      mood: merged.mood,
      focus: merged.focus,
    };
  },
});

export const recentCheckinsTool = defineTool({
  name: "recent_checkins",
  description: [
    "Read the user's recent daily check-ins. Returns rows + computed averages",
    "for the requested window. Defaults to the last 7 days.",
    "",
    "Use when the user asks: 'how's my energy been?', 'mood this week?',",
    "'have I been logging check-ins?'.",
  ].join("\n"),
  schema: z.object({
    days: z.number().int().min(1).max(60).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "integer", minimum: 1, maximum: 60, description: "Default 7." },
    },
  },
  async run(input, ctx) {
    const days = input.days ?? 7;
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    const { data, error } = await ctx.supabase
      .from("daily_checkins")
      .select("log_date, energy, mood, focus, note")
      .eq("user_id", ctx.userId)
      .gte("log_date", ymd(since))
      .order("log_date", { ascending: false });
    if (error) throw new Error(`Failed to load check-ins: ${error.message}`);
    const rows = (data ?? []) as CheckinRow[];

    const avg = (key: "energy" | "mood" | "focus") => {
      const vs = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
      if (vs.length === 0) return null;
      return Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10;
    };

    return {
      window_days: days,
      logged_days: rows.length,
      energy_avg: avg("energy"),
      mood_avg: avg("mood"),
      focus_avg: avg("focus"),
      rows,
    };
  },
});
