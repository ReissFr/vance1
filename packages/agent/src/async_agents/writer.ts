import { z } from "zod";
import { defineBackgroundAgent } from "./registry";

// writer_agent — delegates writing work to the server-side writer pipeline.
// Migrated from tools/writer.ts as the reference BackgroundAgent; adding
// further async agents (outreach, inbox, research, ops, code, concierge)
// should follow this exact shape.
export const writerAgent = defineBackgroundAgent({
  name: "writer_agent",
  description: [
    "Delegate a writing task to Vance's async writer-agent. Use this when the user asks you",
    "to draft an email, LinkedIn post, tweet, cold outreach, message, or any piece of copy",
    "that needs to sound like them and benefits from a proper draft (not a 1-liner).",
    "",
    "This runs server-side in the background. Does NOT execute inline. The user reviews the",
    "draft in the Tasks panel (or gets a WhatsApp ping) and decides whether to send/post it.",
    "Respond with a short acknowledgement like 'On it — I'll ping you with the draft'. Do",
    "not try to write the draft yourself in the chat.",
    "",
    "Good fits: 'draft a reply to Sarah's pricing email', 'write me a LinkedIn post announcing",
    "the JARVIS beta', 'draft cold outreach to 3 potential customers in fintech'. Bad fits:",
    "'reply yes' (too short — just do it inline), 'what should I say' (that's advice, not a",
    "draft — answer in chat).",
  ].join("\n"),
  schema: z.object({
    brief: z
      .string()
      .min(10)
      .max(4000)
      .describe(
        "Full brief for the writer. Who it's to, what to say, what the goal is, anything it should reference. Do not shorten — this is the prompt the writer works from.",
      ),
    format: z
      .enum(["email", "linkedin_post", "whatsapp_reply", "tweet", "cold_outreach", "general"])
      .describe("Output format — shapes length, tone, and structure conventions."),
    title: z
      .string()
      .min(1)
      .max(120)
      .describe("Short human-readable title shown in the Tasks panel (3–10 words)."),
    recipient: z
      .string()
      .max(200)
      .optional()
      .describe("Who the message is for (name/role/company). Optional but helps tone."),
    tone: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Explicit tone guidance if the user asked for something specific (e.g. 'confident but not pushy', 'warm and casual'). Leave empty to use the user's default voice.",
      ),
    length: z
      .enum(["short", "medium", "long"])
      .optional()
      .describe("Rough length target. Defaults to medium."),
    notify: z
      .boolean()
      .optional()
      .describe("WhatsApp the user when the draft is ready. Default true."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      brief: {
        type: "string",
        description: "Full brief: audience, goal, key points, references. Be specific.",
      },
      format: {
        type: "string",
        enum: ["email", "linkedin_post", "whatsapp_reply", "tweet", "cold_outreach", "general"],
        description: "Output format — shapes length and structure.",
      },
      title: { type: "string", description: "Short title for the Tasks panel." },
      recipient: { type: "string", description: "Who the message is for (name/role/company)." },
      tone: { type: "string", description: "Explicit tone guidance if the user asked for one." },
      length: {
        type: "string",
        enum: ["short", "medium", "long"],
        description: "Rough length target. Defaults to medium.",
      },
      notify: { type: "boolean", description: "WhatsApp the user when done. Default true." },
    },
    required: ["brief", "format", "title"],
  },
  buildTaskRow({ input }) {
    const notify = input.notify ?? true;
    return {
      kind: "writer",
      prompt: input.brief,
      args: {
        title: input.title,
        format: input.format,
        recipient: input.recipient,
        tone: input.tone,
        length: input.length ?? "medium",
        notify,
      },
      runnerPath: "/api/tasks/run-writer",
      title: input.title,
      okMessage:
        "Writing task queued. The writer agent is drafting now. Tell the user it's running and you'll ping them when the draft is ready.",
    };
  },
});
