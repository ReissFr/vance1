// Errand agent brain tools. Three tools so the brain can:
//   1. start a new autonomous errand
//   2. list active errands (so it can find the one a WhatsApp reply refers to)
//   3. resume a paused errand with the user's reply
//
// The errand itself runs server-side in lib/errand-run.ts on a 30-min tick,
// orchestrated by the run-scheduled cron.

import { z } from "zod";
import { defineTool } from "./types";

export const startErrandTool = defineTool({
  name: "start_errand",
  description: [
    "Delegate a multi-step real-world goal to Vance's autonomous errand agent.",
    "The agent runs over days on a 30-minute tick: researches, proposes purchases,",
    "WhatsApps the user at key decisions, and finishes when the goal is met.",
    "",
    "Use this when the user wants something DONE over time, not an immediate answer.",
    "Examples: 'get me a cheaper car insurance', 'find a replacement for my broken",
    "standing desk', 'sort out the Monzo dispute on that £89 charge', 'book me a",
    "physio near London Bridge who takes Bupa, next week'.",
    "",
    "Hybrid autonomy: actions under threshold_gbp go ahead silently; anything above,",
    "or recurring, or needing card/personal details, pauses for approval on WhatsApp.",
    "",
    "Do NOT use this for: simple one-turn questions ('what's the weather'), tasks the",
    "user wants done inline right now ('draft an email — use writer_agent'), or things",
    "that don't cross channels ('remind me tomorrow — use ops_agent').",
    "",
    "Respond with a short ack like 'On it — I'll ping you when I need a call'. Do not",
    "try to start researching inline.",
  ].join("\n"),
  schema: z.object({
    goal: z
      .string()
      .min(5)
      .max(500)
      .describe("Plain-English goal. Be specific about constraints (budget, timing, preferences)."),
    budget_gbp: z
      .number()
      .positive()
      .optional()
      .describe("Total spend ceiling in GBP. The agent never commits beyond this."),
    threshold_gbp: z
      .number()
      .positive()
      .optional()
      .describe(
        "Autonomy threshold: the agent can act without asking for spends up to this amount. Default £100.",
      ),
    deadline: z
      .string()
      .optional()
      .describe(
        "ISO datetime by which the errand should be done. Defaults to 7 days from now.",
      ),
  }),
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string", description: "Plain-English goal with constraints." },
      budget_gbp: { type: "number", description: "Total spend ceiling in GBP." },
      threshold_gbp: { type: "number", description: "Ambient autonomy threshold. Default £100." },
      deadline: { type: "string", description: "ISO deadline. Default 7 days." },
    },
    required: ["goal"],
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "errand",
        prompt: input.goal,
        args: {
          goal: input.goal,
          budget_gbp: input.budget_gbp ?? null,
          threshold_gbp: input.threshold_gbp ?? 100,
          deadline: input.deadline ?? null,
          notify: true,
        },
        device_target: "server",
        status: "queued",
        scheduled_at: new Date().toISOString(),
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to enqueue errand: ${error.message}`);
    }

    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-errand`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => {
      console.warn("[start_errand] trigger fetch failed:", e);
    });

    return {
      task_id: data.id,
      status: "queued",
      goal: input.goal,
      threshold_gbp: input.threshold_gbp ?? 100,
      message: "Errand queued. First tick fires immediately; agent will WhatsApp when it needs a decision or finishes.",
    };
  },
});

export const listErrandsTool = defineTool({
  name: "list_errands",
  description: [
    "List the user's active errand tasks with their latest status and any pending",
    "checkpoint question. Use this when the user replies to an errand WhatsApp and",
    "you need to find which errand_id their reply belongs to.",
    "",
    "Returns: id, goal, status, last_summary, pending_checkpoint (if paused).",
    "A status of 'needs_approval' means the errand is waiting on the user to answer.",
  ].join("\n"),
  schema: z.object({
    include_completed: z
      .boolean()
      .optional()
      .describe("If true, also returns done/failed errands (last 5). Default false."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      include_completed: {
        type: "boolean",
        description: "Include done/failed errands too. Default false.",
      },
    },
  },
  async run(input, ctx) {
    const statuses = input.include_completed
      ? ["queued", "running", "needs_approval", "done", "failed"]
      : ["queued", "running", "needs_approval"];
    const { data, error } = await ctx.supabase
      .from("tasks")
      .select("id, status, prompt, args, result, created_at")
      .eq("user_id", ctx.userId)
      .eq("kind", "errand")
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(`Failed to list errands: ${error.message}`);
    return (data ?? []).map((t) => {
      let state: {
        goal?: string;
        status?: string;
        last_summary?: string;
        pending_checkpoint?: { question: string; options: string[] | null } | null;
      } = {};
      if (t.result) {
        try {
          state = JSON.parse(t.result as string);
        } catch {
          // ignore
        }
      }
      return {
        id: t.id,
        task_status: t.status,
        goal: state.goal ?? t.prompt,
        last_summary: state.last_summary ?? null,
        pending_checkpoint: state.pending_checkpoint ?? null,
      };
    });
  },
});

export const errandRespondTool = defineTool({
  name: "errand_respond",
  description: [
    "Feed the user's reply back into a paused errand. Call this when the user's",
    "message is a response to a pending errand checkpoint (an A/B/C pick, a yes/no",
    "approval, a free-form preference).",
    "",
    "Find the right errand_id via list_errands first if you don't already have it.",
    "Pass the user's ACTUAL WORDS as `reply` — don't paraphrase. The errand agent",
    "reads the reply literally and decides what to do next on its next tick (which",
    "fires immediately once you call this).",
    "",
    "After calling this, acknowledge briefly to the user ('Got it, resuming — I'll",
    "ping you with the next update') and stop. Do not try to predict what the",
    "errand will do.",
  ].join("\n"),
  schema: z.object({
    errand_id: z.string().min(1).describe("Task id of the errand to resume."),
    reply: z.string().min(1).max(2000).describe("The user's reply, verbatim."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      errand_id: { type: "string", description: "Task id of the errand." },
      reply: { type: "string", description: "User's reply verbatim." },
    },
    required: ["errand_id", "reply"],
  },
  async run(input, ctx) {
    const { data: task, error: loadErr } = await ctx.supabase
      .from("tasks")
      .select("id, kind, user_id, status, result")
      .eq("id", input.errand_id)
      .single();
    if (loadErr || !task) {
      throw new Error(`Errand not found: ${loadErr?.message ?? "no row"}`);
    }
    if (task.user_id !== ctx.userId) {
      throw new Error("Errand belongs to a different user");
    }
    if (task.kind !== "errand") {
      throw new Error("Task is not an errand");
    }

    let state: { pending_checkpoint?: unknown; history?: unknown[]; status?: string } = {};
    if (task.result) {
      try {
        state = JSON.parse(task.result as string);
      } catch {
        throw new Error("Errand state is corrupt");
      }
    }
    if (!state.pending_checkpoint) {
      return {
        ok: false,
        reason: "Errand has no pending checkpoint — nothing to resume.",
      };
    }

    const history = Array.isArray(state.history) ? state.history : [];
    history.push({
      at: new Date().toISOString(),
      tick: -1,
      action: "resume",
      summary: `User replied: ${input.reply.slice(0, 200)}`,
    });

    const updatedState = {
      ...state,
      pending_checkpoint: null,
      status: "in_progress",
      history,
    };

    const { error: updErr } = await ctx.supabase
      .from("tasks")
      .update({
        status: "queued",
        scheduled_at: new Date().toISOString(),
        result: JSON.stringify(updatedState),
      })
      .eq("id", input.errand_id);
    if (updErr) throw new Error(`Failed to resume errand: ${updErr.message}`);

    // Fire the runner immediately so the user doesn't wait for the next cron tick.
    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";
    void fetch(`${baseUrl}/api/tasks/run-errand`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: input.errand_id }),
    }).catch((e) => {
      console.warn("[errand_respond] trigger fetch failed:", e);
    });

    return { ok: true, errand_id: input.errand_id };
  },
});
