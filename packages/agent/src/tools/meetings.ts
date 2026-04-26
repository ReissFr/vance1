// Meeting Ghost brain tool. Listing + fetching is the useful surface here;
// the actual recording/transcription happens in the browser on /meetings.
// For semantic search across meeting content, use the `recall` tool with
// sources: ["meeting"] — that's the better fit.

import { z } from "zod";
import { defineTool } from "./types";

export const listMeetingsTool = defineTool({
  name: "list_meetings",
  description:
    "List the user's recent meeting sessions (Meeting Ghost recordings) in reverse-chronological order, with title, summary, and action items. Use this for 'what meetings did I have this week?', 'summarise my last call', 'what were the action items from the Tom meeting?'. For semantic search across meeting content, prefer the `recall` tool with sources: ['meeting'].",
  schema: z.object({
    limit: z.number().int().min(1).max(20).optional(),
    only_completed: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max meetings to return, 1–20. Default 10." },
      only_completed: {
        type: "boolean",
        description: "If true, skip any session still in progress. Default true.",
      },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 10;
    const onlyCompleted = input.only_completed ?? true;
    let q = ctx.supabase
      .from("meeting_sessions")
      .select("id, started_at, ended_at, title, summary, action_items, participants")
      .eq("user_id", ctx.userId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (onlyCompleted) q = q.not("ended_at", "is", null);
    const { data, error } = await q;
    if (error) throw new Error(`list_meetings: ${error.message}`);
    return (data ?? []).map((s) => ({
      id: s.id,
      started_at: s.started_at,
      ended_at: s.ended_at,
      duration_min:
        s.ended_at != null
          ? Math.round(
              (new Date(s.ended_at as string).getTime() -
                new Date(s.started_at as string).getTime()) /
                60000,
            )
          : null,
      title: s.title,
      summary: s.summary,
      action_items: s.action_items,
      participants: s.participants ?? [],
    }));
  },
});
