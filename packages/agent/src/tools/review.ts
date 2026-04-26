// Brain-level on-demand tools for the evening wrap-up and weekly review.
// The cron schedulers fire these automatically, but the brain can also queue
// them mid-conversation if the user asks "recap today" or "review the week".

import { z } from "zod";
import { defineTool } from "./types";

function baseUrl(): string {
  return (
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030"
  );
}

export const runEveningWrapTool = defineTool({
  name: "run_evening_wrap",
  description: [
    "Queue an on-demand evening wrap-up — a recap of today (revenue, spend,",
    "meetings, receipts, open loops) + a peek at tomorrow.",
    "",
    "Use when the user asks: 'recap today', 'end-of-day summary', 'wrap my day',",
    "'what did I do today?'. Normally fires automatically at 22:00 London time",
    "if evening_wrap_enabled is on — this tool is for ad-hoc mid-day requests.",
    "",
    "Does NOT return results inline — runs in background, pings the user on WhatsApp.",
  ].join("\n"),
  schema: z.object({
    notify: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      notify: { type: "boolean", description: "WhatsApp ping when done. Default true." },
    },
  },
  async run(input, ctx) {
    const notify = input.notify ?? true;
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "evening_wrap",
        prompt: "Evening wrap-up",
        args: { title: "Evening wrap-up", notify },
        device_target: "server",
        status: "queued",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to queue evening wrap: ${error.message}`);

    void fetch(`${baseUrl()}/api/tasks/run-evening-wrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => console.warn("[run_evening_wrap] trigger failed:", e));

    return {
      task_id: data.id,
      status: "queued",
      message: "Evening wrap queued. Tell the user it's running and you'll ping them with the recap.",
    };
  },
});

export const runWeeklyReviewTool = defineTool({
  name: "run_weekly_review",
  description: [
    "Queue an on-demand weekly review — a 7-day retrospective covering money,",
    "meetings, shipped vs slipped tasks, top merchants, upcoming renewals, and",
    "a focus-for-next-week call.",
    "",
    "Use when the user asks: 'review my week', 'weekly recap', 'Sunday review',",
    "'how did this week go?'. Normally fires automatically Sundays 18:00 London",
    "if weekly_review_enabled is on — this tool is for ad-hoc requests.",
    "",
    "Does NOT return results inline — runs in background, pings the user on WhatsApp.",
  ].join("\n"),
  schema: z.object({
    notify: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      notify: { type: "boolean", description: "WhatsApp ping when done. Default true." },
    },
  },
  async run(input, ctx) {
    const notify = input.notify ?? true;
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "weekly_review",
        prompt: "Weekly review",
        args: { title: "Weekly review", notify },
        device_target: "server",
        status: "queued",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to queue weekly review: ${error.message}`);

    void fetch(`${baseUrl()}/api/tasks/run-weekly-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => console.warn("[run_weekly_review] trigger failed:", e));

    return {
      task_id: data.id,
      status: "queued",
      message: "Weekly review queued. Tell the user it's running and you'll ping them with the retrospective.",
    };
  },
});
