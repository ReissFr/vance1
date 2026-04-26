import { z } from "zod";
import { defineTool } from "./types";
import { recallMemories, saveMemory } from "../memory";

export const saveMemoryTool = defineTool({
  name: "save_memory",
  description:
    "Store a long-term memory about the user (a fact, preference, person, event, or task). Use liberally whenever the user shares something worth remembering between conversations.",
  schema: z.object({
    kind: z.enum(["fact", "preference", "person", "event", "task"]),
    content: z.string().min(1).max(1000),
  }),
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["fact", "preference", "person", "event", "task"],
        description: "Category of memory.",
      },
      content: { type: "string", description: "The memory text, 1–2 sentences." },
    },
    required: ["kind", "content"],
  },
  async run(input, ctx) {
    const m = await saveMemory(ctx.supabase, ctx.embed, {
      userId: ctx.userId,
      kind: input.kind,
      content: input.content,
    });
    return { saved_id: m.id, content: m.content };
  },
});

export const recallMemoryTool = defineTool({
  name: "recall_memory",
  description:
    "Search the user's long-term memory by semantic similarity. Use when you need context about the user's preferences, relationships, or prior statements.",
  schema: z.object({
    query: z.string().min(1).max(500),
    top_k: z.number().int().min(1).max(15).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you want to remember." },
      top_k: { type: "number", description: "How many memories to return (default 6).", default: 6 },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    const results = await recallMemories(ctx.supabase, ctx.embed, {
      userId: ctx.userId,
      query: input.query,
      ...(input.top_k !== undefined ? { topK: input.top_k } : {}),
    });
    return results.map((m) => ({ id: m.id, kind: m.kind, content: m.content, when: m.created_at }));
  },
});
