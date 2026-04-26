// Brain tools for the daily standup log. /standup is the structured
// yesterday/today/blockers daily entry — distinct from intentions (single
// focus) and wins (what shipped). Brain proactively prompts in the morning,
// pulls "what did you say you'd do yesterday" to ground today's intention,
// and surfaces unresolved blockers in briefings.

import { z } from "zod";
import { defineTool } from "./types";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type StandupRow = {
  id: string;
  log_date: string;
  yesterday: string | null;
  today: string | null;
  blockers: string | null;
};

export const logStandupTool = defineTool({
  name: "log_standup",
  description: [
    "Upsert today's standup row (yesterday/today/blockers). All three fields",
    "optional but at least one required. Use when the user says 'standup',",
    "'yesterday I…', 'today I'm going to…', or proactively in the morning.",
    "Re-running for the same day overwrites the row — gives the user a way",
    "to refine throughout the day without creating duplicates.",
  ].join("\n"),
  schema: z.object({
    yesterday: z.string().max(4000).optional(),
    today: z.string().max(4000).optional(),
    blockers: z.string().max(4000).optional(),
    log_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      yesterday: { type: "string" },
      today: { type: "string" },
      blockers: { type: "string" },
      log_date: { type: "string", description: "YYYY-MM-DD; defaults to today" },
    },
  },
  async run(input, ctx) {
    const yesterday = input.yesterday?.trim().slice(0, 4000) || null;
    const today = input.today?.trim().slice(0, 4000) || null;
    const blockers = input.blockers?.trim().slice(0, 4000) || null;
    if (!yesterday && !today && !blockers) {
      return { ok: false, error: "at least one of yesterday/today/blockers required" };
    }
    const logDate = input.log_date ?? todayYmd();
    const { data, error } = await ctx.supabase
      .from("standups")
      .upsert(
        {
          user_id: ctx.userId,
          log_date: logDate,
          yesterday,
          today,
          blockers,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,log_date" },
      )
      .select("id, log_date, yesterday, today, blockers")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, standup: data };
  },
});

export const recentStandupsTool = defineTool({
  name: "recent_standups",
  description: [
    "List recent standup entries (default 7 days, max 30). Returns date +",
    "yesterday/today/blockers per day. Use when the user asks 'what did I",
    "say I'd do' or for weekly reviews / pattern reads ('what's been",
    "blocking me lately').",
  ].join("\n"),
  schema: z.object({
    days: z.number().int().min(1).max(30).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: { days: { type: "number" } },
  },
  async run(input, ctx) {
    const days = input.days ?? 7;
    const sinceDate = new Date(Date.now() - days * 86400000);
    const sinceYmd = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, "0")}-${String(sinceDate.getDate()).padStart(2, "0")}`;
    const { data, error } = await ctx.supabase
      .from("standups")
      .select("id, log_date, yesterday, today, blockers")
      .eq("user_id", ctx.userId)
      .gte("log_date", sinceYmd)
      .order("log_date", { ascending: false });
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as StandupRow[];
    return { ok: true, count: rows.length, standups: rows };
  },
});

export const listBlockersTool = defineTool({
  name: "list_blockers",
  description: [
    "Pull just the non-empty blockers from recent standup entries. Default",
    "14 days, max 60. Use when the user asks 'what's been stuck this week',",
    "in weekly reviews, or proactively when the same blocker shows up across",
    "multiple days (a real signal worth calling out).",
  ].join("\n"),
  schema: z.object({
    days: z.number().int().min(1).max(60).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: { days: { type: "number" } },
  },
  async run(input, ctx) {
    const days = input.days ?? 14;
    const sinceDate = new Date(Date.now() - days * 86400000);
    const sinceYmd = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, "0")}-${String(sinceDate.getDate()).padStart(2, "0")}`;
    const { data, error } = await ctx.supabase
      .from("standups")
      .select("log_date, blockers")
      .eq("user_id", ctx.userId)
      .gte("log_date", sinceYmd)
      .not("blockers", "is", null)
      .order("log_date", { ascending: false });
    if (error) return { ok: false, error: error.message };
    const rows = ((data ?? []) as { log_date: string; blockers: string | null }[]).filter(
      (r) => r.blockers && r.blockers.trim(),
    );
    return { ok: true, count: rows.length, blockers: rows };
  },
});
