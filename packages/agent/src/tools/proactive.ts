import { z } from "zod";
import { defineTool } from "./types";

// Conversational snooze controls for JARVIS proactive nudges.
// The cron worker reads profiles.proactive_snoozed_until and filters snoozed
// users out of each tick. These tools let the user set/clear that timestamp
// via chat ("focus 90m", "quiet for 2 hours", "you can ping me again now").

export const snoozeProactiveTool = defineTool({
  name: "snooze_proactive",
  description:
    "Temporarily mute your own proactive outbound pings. Use when the user says they're in focus, in a meeting, on vacation, or just wants silence for a bit. The mute auto-expires at the chosen time — no need to remember to turn notifications back on.",
  schema: z.object({
    minutes: z.number().int().min(5).max(60 * 24 * 30),
    reason: z.string().max(200).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      minutes: {
        type: "integer",
        minimum: 5,
        maximum: 43200,
        description: "How many minutes to stay quiet for (5 min – 30 days).",
      },
      reason: {
        type: "string",
        description:
          "Short label for why the snooze was set (e.g. 'deep work', 'dinner', 'sick day'). Stored on the tool result only.",
      },
    },
    required: ["minutes"],
  },
  async run(input, ctx) {
    const until = new Date(Date.now() + input.minutes * 60000).toISOString();
    const { error } = await ctx.supabase
      .from("profiles")
      .update({ proactive_snoozed_until: until })
      .eq("id", ctx.userId);
    if (error) throw new Error(`snooze failed: ${error.message}`);
    return {
      snoozed_until: until,
      minutes: input.minutes,
      reason: input.reason ?? null,
    };
  },
});

export const clearProactiveSnoozeTool = defineTool({
  name: "clear_proactive_snooze",
  description:
    "Cancel an active proactive mute so JARVIS can ping again immediately. Only do this when the user explicitly asks to unmute (e.g. 'you can talk to me again', 'cancel the silence').",
  schema: z.object({}).optional(),
  inputSchema: {
    type: "object",
    properties: {},
  },
  async run(_input, ctx) {
    const { error } = await ctx.supabase
      .from("profiles")
      .update({ proactive_snoozed_until: null })
      .eq("id", ctx.userId);
    if (error) throw new Error(`clear snooze failed: ${error.message}`);
    return { cleared: true };
  },
});
