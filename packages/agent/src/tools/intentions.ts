// Brain tools for daily intentions. Sets/reads the one-line "what I want
// to do today" so JARVIS can prompt for it in the morning, recall it at
// midday ("how's that intention going?"), and verify it in the evening wrap.

import { z } from "zod";
import { defineTool } from "./types";

type IntentionRow = {
  id: string;
  log_date: string;
  text: string;
  completed_at: string | null;
  carried_from: string | null;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

export const setIntentionTool = defineTool({
  name: "set_intention",
  description: [
    "Set today's intention — one short sentence the user wants to focus on.",
    "Upserts on today's date (overwrites any earlier setting).",
    "",
    "Use when the user says: 'today I want to ship the demo', 'my focus",
    "today is...', 'set my intention to X'.",
  ].join("\n"),
  schema: z.object({
    text: z.string().min(2).max(280).describe("The intention, one short sentence."),
  }),
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string", description: "The intention, one short sentence." },
    },
  },
  async run(input, ctx) {
    const text = input.text.trim().slice(0, 280);
    if (!text) return { ok: false, error: "empty intention" };
    const today = ymd(new Date());
    const { data, error } = await ctx.supabase
      .from("intentions")
      .upsert(
        {
          user_id: ctx.userId,
          log_date: today,
          text,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,log_date" },
      )
      .select("id, log_date, text")
      .single();
    if (error) return { ok: false, error: error.message };
    const row = data as { id: string; log_date: string; text: string };
    return { ok: true, id: row.id, date: row.log_date, text: row.text };
  },
});

export const todayIntentionTool = defineTool({
  name: "today_intention",
  description: [
    "Get today's intention if one was set, plus a flag for whether it's",
    "been marked done. If nothing's set today, optionally returns the most",
    "recent uncompleted intention as a 'carry forward' suggestion.",
    "",
    "Use when the user asks: 'what was my intention today?', 'did I do",
    "what I planned?', or before evening-wrap to check on it.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const today = ymd(new Date());
    const { data: todayRow } = await ctx.supabase
      .from("intentions")
      .select("id, log_date, text, completed_at, carried_from")
      .eq("user_id", ctx.userId)
      .eq("log_date", today)
      .maybeSingle();

    if (todayRow) {
      const r = todayRow as IntentionRow;
      return {
        has_intention: true,
        text: r.text,
        completed: !!r.completed_at,
        carried_forward: !!r.carried_from,
      };
    }

    // Fall back to most recent uncompleted (last 14 days).
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const { data: recent } = await ctx.supabase
      .from("intentions")
      .select("id, log_date, text, completed_at")
      .eq("user_id", ctx.userId)
      .gte("log_date", ymd(since))
      .is("completed_at", null)
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      has_intention: false,
      suggested_carry_forward: recent
        ? { text: (recent as IntentionRow).text, from_date: (recent as IntentionRow).log_date }
        : null,
    };
  },
});

export const completeIntentionTool = defineTool({
  name: "complete_intention",
  description: [
    "Mark today's intention as done. No-op if no intention was set today.",
    "",
    "Use when the user says: 'I did it', 'tick today's intention',",
    "'completed my intention'.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const today = ymd(new Date());
    const { data: row } = await ctx.supabase
      .from("intentions")
      .select("id, text")
      .eq("user_id", ctx.userId)
      .eq("log_date", today)
      .maybeSingle();
    if (!row) {
      return { ok: false, error: "no intention set today" };
    }
    const r = row as { id: string; text: string };
    const { error } = await ctx.supabase
      .from("intentions")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, text: r.text };
  },
});
