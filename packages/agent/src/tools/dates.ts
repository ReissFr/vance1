// Brain tools for important dates — birthdays, anniversaries, and other
// recurring dates the user wants JARVIS to remember.

import { z } from "zod";
import { defineTool } from "./types";

type DateRow = {
  id: string;
  name: string;
  date_type: "birthday" | "anniversary" | "custom";
  month: number;
  day: number;
  year: number | null;
  lead_days: number;
  note: string | null;
};

function daysUntilNext(month: number, day: number): number {
  const now = new Date();
  const todayY = now.getFullYear();
  let next = new Date(todayY, month - 1, day);
  next.setHours(0, 0, 0, 0);
  const today = new Date(todayY, now.getMonth(), now.getDate());
  if (next < today) next = new Date(todayY + 1, month - 1, day);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

function turningAge(year: number | null, month: number, day: number): number | null {
  if (!year) return null;
  const now = new Date();
  const currentY = now.getFullYear();
  const thisYear = new Date(currentY, month - 1, day);
  const today = new Date(currentY, now.getMonth(), now.getDate());
  const nextYear = thisYear < today ? currentY + 1 : currentY;
  return nextYear - year;
}

export const addImportantDateTool = defineTool({
  name: "add_important_date",
  description: [
    "Save a recurring important date — birthday, anniversary, or other.",
    "Required: name, month (1-12), day (1-31). Optional: date_type",
    "(default 'birthday'), year (so JARVIS can compute age), lead_days",
    "(default 7 — how many days before to nudge), note (gift ideas etc).",
    "",
    "Use when the user says: 'remember mum's birthday is March 4th',",
    "'add Sarah's bday', 'our anniversary is the 12th of June'.",
  ].join("\n"),
  schema: z.object({
    name: z.string().min(1).max(120).describe("Whose date this is."),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    date_type: z.enum(["birthday", "anniversary", "custom"]).optional().default("birthday"),
    year: z.number().int().min(1900).max(2100).optional(),
    lead_days: z.number().int().min(0).max(60).optional().default(7),
    note: z.string().max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["name", "month", "day"],
    properties: {
      name: { type: "string" },
      month: { type: "number" },
      day: { type: "number" },
      date_type: { type: "string", enum: ["birthday", "anniversary", "custom"] },
      year: { type: "number" },
      lead_days: { type: "number" },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("important_dates")
      .insert({
        user_id: ctx.userId,
        name: input.name.trim().slice(0, 120),
        date_type: input.date_type ?? "birthday",
        month: input.month,
        day: input.day,
        year: input.year ?? null,
        lead_days: input.lead_days ?? 7,
        note: input.note?.trim().slice(0, 500) || null,
      })
      .select("id, name, month, day")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; name: string; month: number; day: number };
    return {
      ok: true,
      id: r.id,
      name: r.name,
      days_until_next: daysUntilNext(r.month, r.day),
    };
  },
});

export const upcomingDatesTool = defineTool({
  name: "upcoming_dates",
  description: [
    "List the user's upcoming birthdays and important dates within the next",
    "N days (default 30). Returns each row with days_until_next + turning_age",
    "(if year is known) so the brain can craft a natural reminder.",
    "",
    "Use when the user asks: 'whose birthday is next?', 'any birthdays this",
    "week?', or before morning briefing to surface lead-time nudges.",
  ].join("\n"),
  schema: z.object({
    days: z.number().int().min(1).max(365).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "number", description: "Horizon in days, default 30." },
    },
  },
  async run(input, ctx) {
    const horizon = input.days ?? 30;
    const { data, error } = await ctx.supabase
      .from("important_dates")
      .select("id, name, date_type, month, day, year, lead_days, note")
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };

    const rows = (data ?? []) as DateRow[];
    const enriched = rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        date_type: r.date_type,
        month: r.month,
        day: r.day,
        days_until_next: daysUntilNext(r.month, r.day),
        turning_age: turningAge(r.year, r.month, r.day),
        lead_days: r.lead_days,
        note: r.note,
      }))
      .filter((r) => r.days_until_next <= horizon)
      .sort((a, b) => a.days_until_next - b.days_until_next);

    return { ok: true, count: enriched.length, dates: enriched };
  },
});
