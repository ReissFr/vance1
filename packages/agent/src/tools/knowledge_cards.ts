// Brain tools for the knowledge-cards library. Atomic facts/quotes/principles/
// playbooks/stats the user wants to keep around — distinct from save_memory
// (passive context about the user) and reading (article queue). The brain
// proactively saves cards when the user shares something quotable, and pulls
// them when writing or arguing.

import { z } from "zod";
import { defineTool } from "./types";

const KINDS = [
  "stat",
  "quote",
  "principle",
  "playbook",
  "anecdote",
  "definition",
  "other",
] as const;

type CardRow = {
  id: string;
  claim: string;
  source: string | null;
  url: string | null;
  kind: string;
  tags: string[];
  created_at: string;
};

export const saveCardTool = defineTool({
  name: "save_card",
  description: [
    "Save a knowledge card — an atomic fact, quote, principle, playbook, stat,",
    "anecdote, or definition the user wants to remember. Required: claim",
    "(the actual fact/quote, ≤2000 chars). Optional: source (book/person/",
    "paper/talk it came from), url, kind (stat|quote|principle|playbook|",
    "anecdote|definition|other; defaults to other), tags.",
    "",
    "Use proactively when the user shares something quotable: a stat from a",
    "podcast, a quote from a book, a principle they want to live by, a",
    "playbook from a successful founder, a definition worth fixing in their",
    "head. Different from save_memory (passive context about the user) —",
    "these are external claims the user wants to reference back.",
  ].join("\n"),
  schema: z.object({
    claim: z.string().min(2).max(2000),
    source: z.string().max(200).optional(),
    url: z.string().max(600).optional(),
    kind: z.enum(KINDS).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["claim"],
    properties: {
      claim: { type: "string" },
      source: { type: "string" },
      url: { type: "string" },
      kind: { type: "string", enum: [...KINDS] },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("knowledge_cards")
      .insert({
        user_id: ctx.userId,
        claim: input.claim.trim().slice(0, 2000),
        source: input.source?.trim().slice(0, 200) || null,
        url: input.url?.trim().slice(0, 600) || null,
        kind: input.kind ?? "other",
        tags: input.tags ?? [],
      })
      .select("id, kind")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; kind: string };
    return { ok: true, id: r.id, kind: r.kind };
  },
});

export const searchCardsTool = defineTool({
  name: "search_cards",
  description: [
    "Search the user's knowledge cards. Optional: q (fuzzy across claim and",
    "source), kind (filter to one kind), tag (exact match), limit (default",
    "20, max 100). Returns matching cards in reverse-chronological order.",
    "Use when the user asks 'what was that stat about X', 'which quote was",
    "it about Y', or when composing something where a saved principle/quote",
    "would land harder than paraphrasing.",
  ].join("\n"),
  schema: z.object({
    q: z.string().max(80).optional(),
    kind: z.enum(KINDS).optional(),
    tag: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string" },
      kind: { type: "string", enum: [...KINDS] },
      tag: { type: "string" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 20;
    let q = ctx.supabase
      .from("knowledge_cards")
      .select("id, claim, source, url, kind, tags, created_at")
      .eq("user_id", ctx.userId);
    if (input.kind) q = q.eq("kind", input.kind);
    if (input.tag) q = q.contains("tags", [input.tag]);
    if (input.q && input.q.trim()) {
      const needle = input.q.trim().slice(0, 80);
      q = q.or(`claim.ilike.%${needle}%,source.ilike.%${needle}%`);
    }
    q = q.order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as CardRow[];
    return { ok: true, count: rows.length, cards: rows };
  },
});

export const deleteCardTool = defineTool({
  name: "delete_card",
  description: "Delete a knowledge card by id.",
  schema: z.object({ id: z.string().uuid() }),
  inputSchema: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
  async run(input, ctx) {
    const { error } = await ctx.supabase
      .from("knowledge_cards")
      .delete()
      .eq("id", input.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
});
