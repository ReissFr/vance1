// Brain tools for the idea inbox. Quick capture + recall + status nudges.
// log_idea is intentionally cheap to call so the brain can capture
// shower-thought asides without ceremony.

import { z } from "zod";
import { defineTool } from "./types";

type IdeaRow = {
  id: string;
  text: string;
  kind: string;
  status: string;
  heat: number;
  adopted_to: string | null;
  note: string | null;
  created_at: string;
};

export const logIdeaTool = defineTool({
  name: "log_idea",
  description: [
    "Capture an idea / shower thought / what-if into the user's idea inbox.",
    "Required: text. Optional: kind ('product'|'content'|'venture'|'optimization'|'other'),",
    "heat 1-5 (default 3 — how excited are they), note (extra context).",
    "",
    "Be proactive: when the user says 'what if X', 'idea: Y', 'I wonder if we",
    "could Z' — log it without asking permission. They can sort later.",
  ].join("\n"),
  schema: z.object({
    text: z.string().min(2).max(2000),
    kind: z.enum(["product", "content", "venture", "optimization", "other"]).optional().default("other"),
    heat: z.number().int().min(1).max(5).optional().default(3),
    note: z.string().max(1000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string" },
      kind: { type: "string", enum: ["product", "content", "venture", "optimization", "other"] },
      heat: { type: "number", description: "1-5 self-rated excitement, default 3" },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("ideas")
      .insert({
        user_id: ctx.userId,
        text: input.text.trim().slice(0, 2000),
        kind: input.kind ?? "other",
        heat: input.heat ?? 3,
        note: input.note?.trim().slice(0, 1000) || null,
      })
      .select("id, text, kind, heat")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; text: string; kind: string; heat: number };
    return { ok: true, id: r.id, text: r.text, kind: r.kind, heat: r.heat };
  },
});

export const listIdeasTool = defineTool({
  name: "list_ideas",
  description: [
    "List the user's ideas. Status filter: 'active' (fresh+exploring, default),",
    "'fresh', 'exploring', 'shelved', 'adopted', 'all'. Sorted heat desc, then",
    "newest first. Use when the user says 'what ideas do I have', 'remind me",
    "of that thing I thought about', 'what should I work on next'.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "fresh", "exploring", "shelved", "adopted", "all"]).optional().default("active"),
    kind: z.enum(["product", "content", "venture", "optimization", "other"]).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "fresh", "exploring", "shelved", "adopted", "all"] },
      kind: { type: "string", enum: ["product", "content", "venture", "optimization", "other"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 30;
    let q = ctx.supabase
      .from("ideas")
      .select("id, text, kind, status, heat, adopted_to, note, created_at")
      .eq("user_id", ctx.userId);
    if (status === "active") {
      q = q.in("status", ["fresh", "exploring"]);
    } else if (status !== "all") {
      q = q.eq("status", status);
    }
    if (input.kind) q = q.eq("kind", input.kind);
    q = q.order("heat", { ascending: false }).order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as IdeaRow[];
    return {
      ok: true,
      count: rows.length,
      ideas: rows.map((r) => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        status: r.status,
        heat: r.heat,
        adopted_to: r.adopted_to,
        note: r.note,
        captured_at: r.created_at,
      })),
    };
  },
});

export const updateIdeaTool = defineTool({
  name: "update_idea",
  description: [
    "Move an idea forward. Identify by id (preferred — from list_ideas) or by",
    "partial text (fuzzy match). Operations:",
    "- status: 'fresh' | 'exploring' | 'shelved' | 'adopted'",
    "- heat: 1-5 (re-rate excitement)",
    "- adopted_to: free-form note like 'became goal: ship v1' (only meaningful",
    "  when status='adopted')",
    "- note: append/replace context",
    "",
    "Use when: user picks one to work on ('let's do that newsletter idea'),",
    "shelves one ('not the right time for X'), or graduates one to a goal/win.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid().optional(),
    text_match: z.string().min(2).max(200).optional(),
    status: z.enum(["fresh", "exploring", "shelved", "adopted"]).optional(),
    heat: z.number().int().min(1).max(5).optional(),
    adopted_to: z.string().max(200).optional(),
    note: z.string().max(1000).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      text_match: { type: "string", description: "Fuzzy match against idea text if id unknown" },
      status: { type: "string", enum: ["fresh", "exploring", "shelved", "adopted"] },
      heat: { type: "number" },
      adopted_to: { type: "string" },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    let id = input.id;
    if (!id) {
      if (!input.text_match) return { ok: false, error: "id or text_match required" };
      const { data } = await ctx.supabase
        .from("ideas")
        .select("id, text")
        .eq("user_id", ctx.userId)
        .in("status", ["fresh", "exploring"])
        .ilike("text", `%${input.text_match}%`)
        .order("created_at", { ascending: false })
        .limit(5);
      const matches = (data ?? []) as Array<{ id: string; text: string }>;
      if (matches.length === 0) return { ok: false, error: "no active idea matches that text" };
      if (matches.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: matches.map((m) => ({ id: m.id, text: m.text })),
        };
      }
      id = matches[0]!.id;
    }

    const patch: Record<string, unknown> = {};
    if (input.status) patch.status = input.status;
    if (typeof input.heat === "number") patch.heat = input.heat;
    if (input.adopted_to !== undefined) {
      patch.adopted_to = input.adopted_to.trim().slice(0, 200) || null;
    }
    if (input.note !== undefined) {
      patch.note = input.note.trim().slice(0, 1000) || null;
    }
    if (Object.keys(patch).length === 0) return { ok: false, error: "nothing to update" };
    patch.updated_at = new Date().toISOString();

    const { error } = await ctx.supabase
      .from("ideas")
      .update(patch)
      .eq("id", id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id };
  },
});
