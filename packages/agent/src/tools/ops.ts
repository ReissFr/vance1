import { z } from "zod";
import { defineTool } from "./types";

// ops_agent — schedules work for later. Two modes:
//   1. "reminder" — at scheduled_at, send the user a WhatsApp with `message`.
//      Runs via a tiny reminder runner; no LLM call needed.
//   2. "delegate" — at scheduled_at, enqueue and fire the matching specialist
//      agent (research / writer / outreach). Scheduled_at + the child task's
//      kind-specific args live on the row.
//
// Scheduled tasks sit in status='queued' with scheduled_at > now() and are NOT
// fire-and-forget triggered on insert. A cron endpoint (/api/cron/run-scheduled)
// polls for due tasks and dispatches them.

const reminderSchema = z.object({
  mode: z.literal("reminder"),
  title: z.string().min(1).max(120).describe("Short title for the Tasks panel (e.g. 'Call plumber')."),
  message: z
    .string()
    .min(1)
    .max(600)
    .describe("The exact text to send on WhatsApp when the reminder fires. Plain text."),
  scheduled_at: z
    .string()
    .datetime()
    .describe(
      "When to fire. ISO 8601 with timezone (e.g. '2026-04-18T09:00:00+01:00'). MUST be in the future. Resolve relative times like 'tomorrow 9am' to an absolute timestamp before calling.",
    ),
});

const delegateResearchSchema = z.object({
  mode: z.literal("delegate"),
  delegate_to: z.literal("research_agent"),
  title: z.string().min(1).max(120),
  scheduled_at: z.string().datetime(),
  brief: z
    .string()
    .min(10)
    .max(4000)
    .describe("The research brief — what to investigate. Same shape as research_agent.brief."),
  depth: z.enum(["quick", "standard", "deep"]).optional(),
  notify: z.boolean().optional(),
});

const delegateWriterSchema = z.object({
  mode: z.literal("delegate"),
  delegate_to: z.literal("writer_agent"),
  title: z.string().min(1).max(120),
  scheduled_at: z.string().datetime(),
  brief: z.string().min(10).max(4000),
  format: z
    .enum(["email", "linkedin_post", "whatsapp_reply", "tweet", "cold_outreach", "general"])
    .optional(),
  recipient: z.string().max(200).optional(),
  tone: z.string().max(200).optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
  notify: z.boolean().optional(),
});

const delegateInboxSchema = z.object({
  mode: z.literal("delegate"),
  delegate_to: z.literal("inbox_agent"),
  title: z.string().min(1).max(120),
  scheduled_at: z.string().datetime(),
  query: z.string().max(400).optional(),
  max: z.number().int().min(1).max(30).optional(),
  notify: z.boolean().optional(),
});

const opsSchema = z.union([
  reminderSchema,
  delegateResearchSchema,
  delegateWriterSchema,
  delegateInboxSchema,
]);

export const opsAgentTool = defineTool({
  name: "ops_agent",
  description: [
    "Schedule work for later. Use this when the user wants something to happen at a",
    "specific future time rather than immediately.",
    "",
    "Modes:",
    "- mode='reminder': send a WhatsApp ping at scheduled_at with the given message.",
    "  Good for: 'remind me to call the plumber tomorrow 9am', 'text me at 6pm to leave",
    "  for the gym'. No LLM work at fire time — just the message you provide.",
    "- mode='delegate', delegate_to='research_agent': kick off a research task at",
    "  scheduled_at. Good for 'every Monday morning, research AI funding rounds from last",
    "  week' (for now, single-fire — recurrence is a future feature).",
    "- mode='delegate', delegate_to='writer_agent': kick off a writing task at scheduled_at.",
    "  Good for 'draft next week's LinkedIn post on Monday morning'.",
    "- mode='delegate', delegate_to='inbox_agent': triage the inbox at scheduled_at.",
    "  Good for 'every morning at 8am, triage my unread emails and draft replies'.",
    "",
    "Time handling: scheduled_at MUST be an absolute ISO 8601 timestamp with timezone and",
    "MUST be in the future. Before calling, resolve relative times ('tomorrow 9am', 'in",
    "2 hours', 'next Monday at noon') to absolute timestamps yourself. The user's timezone",
    "is Europe/London unless they've said otherwise.",
    "",
    "Tell the user what you've scheduled (title + when in human terms). Do not try to",
    "execute the work inline — that's the whole point.",
  ].join("\n"),
  schema: opsSchema,
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["reminder", "delegate"],
        description: "'reminder' sends a WhatsApp message. 'delegate' schedules another agent to run.",
      },
      title: { type: "string", description: "Short title for the Tasks panel." },
      scheduled_at: {
        type: "string",
        description: "ISO 8601 timestamp with timezone. Must be in the future.",
      },
      // reminder-only
      message: {
        type: "string",
        description: "For mode='reminder': the WhatsApp text to send when it fires.",
      },
      // delegate-only
      delegate_to: {
        type: "string",
        enum: ["research_agent", "writer_agent", "inbox_agent"],
        description: "For mode='delegate': which specialist agent to run.",
      },
      brief: {
        type: "string",
        description: "For mode='delegate' with research/writer: the prompt/brief for the delegated agent.",
      },
      query: {
        type: "string",
        description: "For delegate_to='inbox_agent': Gmail search query. Default 'is:unread newer_than:1d'.",
      },
      max: {
        type: "number",
        description: "For delegate_to='inbox_agent': max emails to triage (1-30). Default 15.",
      },
      depth: {
        type: "string",
        enum: ["quick", "standard", "deep"],
        description: "For delegate_to='research_agent'.",
      },
      format: {
        type: "string",
        enum: ["email", "linkedin_post", "whatsapp_reply", "tweet", "cold_outreach", "general"],
        description: "For delegate_to='writer_agent'.",
      },
      recipient: {
        type: "string",
        description: "For delegate_to='writer_agent'.",
      },
      tone: {
        type: "string",
        description: "For delegate_to='writer_agent'.",
      },
      length: {
        type: "string",
        enum: ["short", "medium", "long"],
        description: "For delegate_to='writer_agent'.",
      },
      notify: {
        type: "boolean",
        description: "WhatsApp ping when delegated work completes. Default true.",
      },
    },
    required: ["mode", "title", "scheduled_at"],
  },
  async run(input, ctx) {
    const scheduledAt = new Date(input.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new Error("scheduled_at is not a valid ISO 8601 timestamp");
    }
    if (scheduledAt.getTime() <= Date.now()) {
      throw new Error(
        `scheduled_at must be in the future. Got ${input.scheduled_at} (now is ${new Date().toISOString()}).`,
      );
    }

    if (input.mode === "reminder") {
      const { data, error } = await ctx.supabase
        .from("tasks")
        .insert({
          user_id: ctx.userId,
          kind: "reminder",
          prompt: input.message,
          args: {
            title: input.title,
            message: input.message,
          },
          device_target: "server",
          status: "queued",
          scheduled_at: scheduledAt.toISOString(),
        })
        .select("id, created_at")
        .single();
      if (error) throw new Error(`Failed to schedule reminder: ${error.message}`);
      return {
        task_id: data.id,
        status: "scheduled",
        kind: "reminder",
        title: input.title,
        scheduled_at: scheduledAt.toISOString(),
        message:
          "Reminder scheduled. Tell the user what you've set and confirm the time in their local timezone.",
      };
    }

    // delegate
    const notify = input.notify ?? true;
    let kind: string;
    let prompt: string;
    const args: Record<string, unknown> = {
      title: input.title,
      notify,
    };
    if (input.delegate_to === "research_agent") {
      kind = "research";
      prompt = input.brief;
      args.brief = input.brief;
      if (input.depth) args.depth = input.depth;
    } else if (input.delegate_to === "writer_agent") {
      kind = "writer";
      prompt = input.brief;
      args.brief = input.brief;
      if (input.format) args.format = input.format;
      if (input.recipient) args.recipient = input.recipient;
      if (input.tone) args.tone = input.tone;
      if (input.length) args.length = input.length;
    } else {
      // inbox_agent
      kind = "inbox";
      const query = input.query ?? "is:unread newer_than:1d";
      const max = input.max ?? 15;
      prompt = `Triage inbox: ${query}`;
      args.query = query;
      args.max = max;
    }

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind,
        prompt,
        args,
        device_target: "server",
        status: "queued",
        scheduled_at: scheduledAt.toISOString(),
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(`Failed to schedule ${kind} task: ${error.message}`);
    return {
      task_id: data.id,
      status: "scheduled",
      kind,
      delegate_to: input.delegate_to,
      title: input.title,
      scheduled_at: scheduledAt.toISOString(),
      message:
        "Task scheduled. Tell the user what you've set and confirm the time in their local timezone.",
    };
  },
});
