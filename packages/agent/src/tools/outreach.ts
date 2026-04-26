import { z } from "zod";
import { defineTool } from "./types";

// Queues a cold-outreach campaign. The PA delegates "draft N personalized
// cold emails to these prospects" to a specialist agent. Produces one
// tailored draft per prospect; lands in needs_approval with a batch-approval
// UI that creates N Gmail drafts in one click.
export const outreachAgentTool = defineTool({
  name: "outreach_agent",
  description: [
    "Delegate a cold-outreach campaign to Vance's async outreach-agent. Use this when the",
    "user gives you a list of prospects + a campaign goal and wants personalized messages",
    "drafted for each one.",
    "",
    "This runs server-side. Does NOT execute inline. User reviews all drafts in the Tasks",
    "panel and clicks Approve to create a batch of Gmail drafts (does NOT auto-send —",
    "they still hit 'Send' in Gmail). Respond with a short ack like 'On it — I'll have",
    "drafts ready shortly'. Do not try to draft inline.",
    "",
    "Good fits: 'draft cold emails to these 5 fintech founders about JARVIS',",
    "'write intro emails to Jane (CTO, Acme) and Tom (Head of Ops, Beta Corp)'.",
    "",
    "Bad fits: single email to one person (use writer_agent with format=email),",
    "'find me prospects' (use research_agent first), auto-sending (not supported — this",
    "tool only drafts).",
    "",
    "Prospects MUST include a valid email address for each. If the user only gave names,",
    "tell them you need emails before you can proceed — do NOT guess or invent addresses.",
  ].join("\n"),
  schema: z.object({
    campaign_goal: z
      .string()
      .min(10)
      .max(2000)
      .describe(
        "Why are we reaching out. The ask, the value prop, any proof/credibility points to weave in.",
      ),
    prospects: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          email: z.string().email(),
          company: z.string().max(120).optional(),
          role: z.string().max(120).optional(),
          context: z
            .string()
            .max(600)
            .optional()
            .describe("Anything specific about this person — why them, mutual connection, recent news."),
        }),
      )
      .min(1)
      .max(20)
      .describe("List of prospects. Each MUST have a real email address."),
    title: z.string().min(1).max(120).describe("Campaign title for the Tasks panel."),
    tone: z
      .string()
      .max(200)
      .optional()
      .describe("Tone guidance. Default: warm, direct, respectful of their time."),
    notify: z.boolean().optional().describe("WhatsApp ping when drafts are ready. Default true."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      campaign_goal: {
        type: "string",
        description: "Why we're reaching out. The ask and value prop.",
      },
      prospects: {
        type: "array",
        description: "List of prospects. Each must have a valid email address.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            company: { type: "string" },
            role: { type: "string" },
            context: { type: "string", description: "Anything specific about this prospect." },
          },
          required: ["name", "email"],
        },
      },
      title: { type: "string", description: "Campaign title for the Tasks panel." },
      tone: { type: "string", description: "Optional tone guidance." },
      notify: { type: "boolean", description: "WhatsApp ping when done. Default true." },
    },
    required: ["campaign_goal", "prospects", "title"],
  },
  async run(input, ctx) {
    const notify = input.notify ?? true;

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "outreach",
        prompt: input.campaign_goal,
        args: {
          title: input.title,
          campaign_goal: input.campaign_goal,
          prospects: input.prospects,
          tone: input.tone,
          notify,
        },
        device_target: "server",
        status: "queued",
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to enqueue outreach task: ${error.message}`);
    }

    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-outreach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => {
      console.warn("[outreach_agent] trigger fetch failed:", e);
    });

    return {
      task_id: data.id,
      status: "queued",
      title: input.title,
      prospect_count: input.prospects.length,
      notify,
      message:
        "Outreach campaign queued. Drafts will be ready for review shortly. Tell the user it's running and you'll ping them when drafts are ready.",
    };
  },
});
