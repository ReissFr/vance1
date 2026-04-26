// recall — semantic search across the user's unified archive (Total Recall).
// Powered by the `match_recall_events` RPC + voyage embedding.

import { z } from "zod";
import { defineTool } from "./types";

const VALID_SOURCES = ["email", "chat", "calendar", "whatsapp", "screen", "meeting", "note"] as const;

export const recallTool = defineTool({
  name: "recall",
  description:
    "Semantic search across the user's unified life archive: every indexed email, chat turn, calendar event, WhatsApp, meeting transcript, and screen OCR. Use this for 'what did Tom say about pricing?', 'when did I last speak to Sarah?', 'find that restaurant Anna recommended in March'. Prefer this over browser/email tools for anything the user plausibly saw or said in the past.",
  schema: z.object({
    query: z.string().min(1),
    sources: z.array(z.enum(VALID_SOURCES)).optional(),
    since: z.string().optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural-language search — what you're trying to recall. E.g. 'pricing discussion with Tom', 'Lisbon restaurant recommendations', 'the invoice from the window cleaner'.",
      },
      sources: {
        type: "array",
        items: { type: "string", enum: [...VALID_SOURCES] },
        description: "Optional: restrict to one or more sources. Leave empty to search everything.",
      },
      since: {
        type: "string",
        description: "Optional ISO date — only return events that occurred after this time.",
      },
      limit: {
        type: "number",
        description: "Max results, 1–25. Default 12.",
      },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    const embedding = await ctx.embed(input.query.slice(0, 6000));
    const { data, error } = await ctx.supabase.rpc("match_recall_events", {
      p_user_id: ctx.userId,
      p_query_embedding: embedding,
      p_match_count: input.limit ?? 12,
      p_sources: input.sources && input.sources.length ? input.sources : null,
      p_since: input.since ?? null,
    });
    if (error) throw new Error(`recall: ${error.message}`);
    const rows = (data ?? []) as Array<{
      id: string;
      source: string;
      title: string | null;
      body: string;
      participants: string[] | null;
      occurred_at: string;
      url: string | null;
      similarity: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      occurred_at: r.occurred_at,
      participants: r.participants ?? [],
      url: r.url,
      similarity: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
      // Keep the body short in tool output — the brain rarely needs more than
      // a snippet to cite. Callers can `read_email` etc. for the full thing.
      snippet: r.body.slice(0, 500),
    }));
  },
});
