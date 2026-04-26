import { z } from "zod";
import { defineTool } from "./types";

// Queues a background research task. The PA delegates "go find out X" work to a
// specialist researcher agent that runs server-side (no local machine needed —
// works from WhatsApp even when the laptop is off). The tool returns a
// task_id; progress and the final report stream into the Tasks panel, and the
// user gets pinged when it's done.
export const researchAgentTool = defineTool({
  name: "research_agent",
  description: [
    "Delegate a research task to Vance's async researcher-agent. Use this when the user asks",
    "you to investigate, find out, look into, compare, or summarise something from the web —",
    "anything that needs browsing multiple sources, cross-checking facts, or producing a",
    "written brief.",
    "",
    "This runs server-side in the background. Does NOT execute inline. The user watches the",
    "Tasks panel (or gets a WhatsApp ping) when the report is ready. Respond with a short",
    "acknowledgement like 'On it — I'll ping you when I've got something' and the task_id.",
    "Do not try to answer the research question yourself.",
    "",
    "Good fits: 'research the best CRM for a solo founder and write me a brief', 'find out",
    "which UK grants SevenPoint might qualify for', 'compare Stripe and Paddle for SaaS'.",
    "Bad fits: 'what's 2+2', 'what did I email yesterday' (use gmail tools), 'what's the",
    "weather' (use weather tool).",
  ].join("\n"),
  schema: z.object({
    prompt: z
      .string()
      .min(10)
      .max(4000)
      .describe(
        "Full research brief for the agent. Be specific: what question, what angle, what output. Do not shorten into keywords — this is the prompt the researcher works from.",
      ),
    title: z
      .string()
      .min(1)
      .max(120)
      .describe("Short human-readable title shown in the Tasks panel (3–10 words)."),
    notify: z
      .boolean()
      .optional()
      .describe(
        "If true, WhatsApp the user when the research is done. Default true — only set false if the user explicitly said not to ping them.",
      ),
  }),
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Full research brief. Be specific about question, angle, and desired output format.",
      },
      title: {
        type: "string",
        description: "Short human-readable title (3–10 words).",
      },
      notify: {
        type: "boolean",
        description: "Ping the user on WhatsApp when done. Default true.",
      },
    },
    required: ["prompt", "title"],
  },
  async run(input, ctx) {
    const notify = input.notify ?? true;

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "research",
        prompt: input.prompt,
        args: {
          title: input.title,
          notify,
        },
        device_target: "server",
        status: "queued",
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to enqueue research task: ${error.message}`);
    }

    // Fire-and-forget trigger to the server-side runner. The route kicks off
    // the Anthropic loop and returns immediately; the task progresses
    // independently of this brain turn.
    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => {
      console.warn("[research_agent] trigger fetch failed:", e);
    });

    return {
      task_id: data.id,
      status: "queued",
      title: input.title,
      notify,
      message:
        "Research task queued. The researcher agent is starting now. Tell the user it's running and you'll let them know when the brief is ready.",
    };
  },
});
