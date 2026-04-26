import { z } from "zod";
import { defineTool } from "./types";

// Queues a background concierge task. The PA delegates "go do X on a real
// website" work to the concierge agent — searching flights, looking up
// restaurants, checking prices, comparing hotels, browsing any public site
// and returning a structured answer. Runs server-side in a headless browser;
// works from WhatsApp even when the laptop is off.
//
// Scope today: public / logged-out flows only. Booking flows that require
// login (Uber, OpenTable account, Booking confirmation) are NOT yet
// supported — this will pause at the checkout / login screen and return.
export const conciergeAgentTool = defineTool({
  name: "concierge_task",
  description: [
    "Delegate a real-world task to Vance's concierge agent. It drives a headless browser",
    "to search, compare, and gather information from any public website — restaurants,",
    "flights, hotels, products, tickets, opening times, reviews.",
    "",
    "This runs server-side in the background. Does NOT execute inline. Respond with a",
    "short acknowledgement like 'On it — I'll ping you when it's done' and the task_id.",
    "Do not try to perform the task yourself using other tools.",
    "",
    "Good fits: 'find the cheapest flight London->Lisbon next Friday', 'look up pasta",
    "places open Thursday 7:30pm in Shoreditch with 4+ stars', 'check if the new iPhone",
    "case I want is in stock at John Lewis', 'what's the opening time of the V&A on Sunday'.",
    "",
    "Bad fits: 'reply to this email' (use draft_email), 'what did I spend on X' (use",
    "banking_spending), 'research open-source CRMs and write me a brief' (use research_agent",
    "\u2014 that's for synthesising written briefs, not transactional web browsing).",
    "",
    "Transactional: uses the user's pre-signed-in cookies (Uber, Amazon, Deliveroo, etc.)",
    "from /sites so it can book rides, order food, and buy things. Sends WhatsApp pings",
    "at key moments (found option, confirming price, booked, driver arrived). For spends",
    "over the autonomy limit or requiring card details, it pauses for WhatsApp approval.",
    "Do NOT use browser_* tools inline for these tasks — those block the chat turn and",
    "can't send progress pings. Always route web/browser work through here.",
  ].join("\n"),
  schema: z.object({
    prompt: z
      .string()
      .min(10)
      .max(2000)
      .describe(
        "Full task brief for the concierge. Be specific: what to find, where, what constraints (price, time, location, rating). Don't shorten into keywords — this is the prompt the agent works from.",
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
        "If true, WhatsApp the user when the task is done. Default true — only set false if the user said not to ping them.",
      ),
  }),
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Full task brief for the concierge. Be specific about what to find and constraints.",
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
        kind: "concierge",
        prompt: input.prompt,
        args: { title: input.title, notify },
        device_target: "server",
        status: "queued",
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to enqueue concierge task: ${error.message}`);
    }

    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-concierge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => {
      console.warn("[concierge_task] trigger fetch failed:", e);
    });

    return {
      task_id: data.id,
      status: "queued",
      title: input.title,
      notify,
      message:
        "Concierge task queued. The agent is starting a headless browser now. Tell the user it's running and you'll let them know when it's done.",
    };
  },
});
