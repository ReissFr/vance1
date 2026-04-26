import { z } from "zod";
import { defineTool } from "./types";

// Enqueues a long-running code task. The actual execution happens in a worker
// process spawned by the Tauri host — the brain just books the job and gets
// back a task_id the UI can watch over Supabase Realtime.
export const codeAgentTool = defineTool({
  name: "code_agent",
  description: [
    "Delegate a coding task to Vance's async code-agent. Use this when the user asks you to",
    "write, edit, debug, refactor, or investigate code in a local repo — anything that will",
    "take more than a few seconds or requires running tools like Bash / Read / Edit.",
    "",
    "This does NOT execute inline. It queues a background task; the user watches progress",
    "in the Tasks panel and can approve/cancel from there. Respond to the user with a short",
    "acknowledgement like 'On it — I'll let you know when it's done' and a reference to the",
    "task_id you get back. Do not try to narrate progress yourself.",
    "",
    "Good fits: 'finish the claude project in visual studio code', 'fix the failing test in",
    "apps/web', 'add a dark mode toggle to Settings'. Bad fits: 'what is 2+2', 'summarise my",
    "inbox' (use email tools).",
  ].join("\n"),
  schema: z.object({
    prompt: z
      .string()
      .min(10)
      .max(4000)
      .describe(
        "Full instructions for the code agent. Be specific: what repo area, what outcome, what to verify. Do not shorten into keywords — this is the prompt the agent will work from.",
      ),
    repo_path: z
      .string()
      .max(500)
      .optional()
      .describe(
        "OPTIONAL. Absolute path to the repo — ONLY set this if the user has named a specific repo path in this conversation. If the user just says 'this project' or 'the jarvis repo' or doesn't specify, LEAVE THIS EMPTY and the worker will use the default repo. Do NOT guess paths from the user's name or other context.",
      ),
    title: z
      .string()
      .min(1)
      .max(120)
      .describe("Short human-readable title shown in the Tasks panel (3–10 words)."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Full instructions for the code agent. Be specific about repo, files, outcome, and what to verify.",
      },
      repo_path: {
        type: "string",
        description: "OPTIONAL. Absolute path to the repo — only set if the user explicitly named a path in conversation. Leave empty to use the default repo. Do NOT guess from context (names, display names, etc).",
      },
      title: {
        type: "string",
        description: "Short human-readable title (3–10 words).",
      },
    },
    required: ["prompt", "title"],
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "code_agent",
        prompt: input.prompt,
        args: {
          title: input.title,
          ...(input.repo_path ? { repo_path: input.repo_path } : {}),
        },
        device_target: "local",
        status: "queued",
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to enqueue code task: ${error.message}`);
    }

    return {
      task_id: data.id,
      status: "queued",
      title: input.title,
      repo_path: input.repo_path ?? "(default)",
      message:
        "Task queued. The user's Mac worker will pick it up and stream progress into the Tasks panel. Tell the user it's running and you'll let them know when it's done.",
    };
  },
});
