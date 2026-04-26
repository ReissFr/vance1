import { z } from "zod";
import { defineTool } from "./types";

// Queues an inbox-triage task. The agent pulls recent messages matching the
// Gmail search query, classifies each (needs_reply / fyi / newsletter / spam /
// action_required), and drafts a reply in Reiss's voice for the ones that
// need one. Lands in needs_approval — the user batch-approves the replies and
// N Gmail draft replies are created (threaded to the original).
//
// Runs server-side (no local machine needed). Pairs naturally with ops_agent:
// "every morning at 8am, triage my inbox" delegates to this.
export const inboxAgentTool = defineTool({
  name: "inbox_agent",
  description: [
    "Delegate inbox triage to Vance's async inbox-agent. Use this when the user wants",
    "their unread emails sorted and replies drafted for the ones that need them.",
    "",
    "This runs server-side in the background. Does NOT execute inline. The user reviews",
    "the triage result in the Tasks panel and approves a batch — Gmail DRAFT REPLIES are",
    "created (threaded to the original). Does NOT auto-send. Respond with a short ack like",
    "'On it — I'll triage and ping you with drafts'. Do not try to read or classify mail",
    "inline.",
    "",
    "Good fits: 'triage my inbox', 'draft replies for anything urgent in my unread',",
    "'go through emails from the last 3 days and handle what you can'.",
    "",
    "Query syntax is Gmail's (is:unread, newer_than:2d, from:foo@bar.com, label:X, etc.).",
    "Default is 'is:unread newer_than:1d' which is the PA's morning-triage shape.",
    "",
    "Bad fits: reading ONE specific email (use list_emails + read_email inline),",
    "auto-sending (not supported — this tool only drafts).",
  ].join("\n"),
  schema: z.object({
    title: z
      .string()
      .min(1)
      .max(120)
      .describe("Short title for the Tasks panel (e.g. 'Morning inbox triage')."),
    query: z
      .string()
      .max(400)
      .optional()
      .describe(
        "Gmail search query. Defaults to 'is:unread newer_than:1d'. Examples: 'is:unread', 'from:alex@example.com newer_than:7d', 'label:important is:unread'.",
      ),
    max: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Cap on emails to triage in one run. Default 15, max 30."),
    notify: z.boolean().optional().describe("WhatsApp ping when triage is ready. Default true."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the Tasks panel." },
      query: {
        type: "string",
        description: "Gmail search query. Defaults to 'is:unread newer_than:1d'.",
      },
      max: {
        type: "number",
        description: "Cap on emails to triage (1–30). Default 15.",
      },
      notify: { type: "boolean", description: "WhatsApp ping when done. Default true." },
    },
    required: ["title"],
  },
  async run(input, ctx) {
    const notify = input.notify ?? true;
    const query = input.query ?? "is:unread newer_than:1d";
    const max = input.max ?? 15;

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "inbox",
        prompt: `Triage inbox: ${query}`,
        args: {
          title: input.title,
          query,
          max,
          notify,
        },
        device_target: "server",
        status: "queued",
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to enqueue inbox task: ${error.message}`);
    }

    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-inbox`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => {
      console.warn("[inbox_agent] trigger fetch failed:", e);
    });

    return {
      task_id: data.id,
      status: "queued",
      title: input.title,
      query,
      max,
      notify,
      message:
        "Inbox triage queued. Tell the user it's running and you'll ping them when drafts are ready for review.",
    };
  },
});
