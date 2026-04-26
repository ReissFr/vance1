// Brain tools for the reflections log. log_reflection is proactive: when the
// user says "I learned X", "I should have Y", "I realised Z", capture it
// without ceremony. The retrospective layer that compounds into weekly digests.

import { z } from "zod";
import { defineTool } from "./types";

type ReflectionRow = {
  id: string;
  text: string;
  kind: string;
  tags: string[];
  created_at: string;
};

const KINDS = ["lesson", "regret", "realisation", "observation", "gratitude", "other"] as const;

export const logReflectionTool = defineTool({
  name: "log_reflection",
  description: [
    "Capture a reflection — a lesson, regret, realisation, observation, or",
    "gratitude — into the user's journal. Required: text. Optional: kind,",
    "tags.",
    "",
    "Be proactive: when the user says 'I learned', 'I should have', 'I",
    "realised', 'next time I'll', 'in hindsight', 'grateful for' — log it.",
    "Different from log_idea (forward-looking possibilities) and",
    "log_decision (committed choices) — reflections are retrospective.",
  ].join("\n"),
  schema: z.object({
    text: z.string().min(2).max(4000),
    kind: z.enum(KINDS).optional().default("observation"),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string" },
      kind: { type: "string", enum: [...KINDS] },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("reflections")
      .insert({
        user_id: ctx.userId,
        text: input.text.trim().slice(0, 4000),
        kind: input.kind ?? "observation",
        tags: input.tags ?? [],
      })
      .select("id, text, kind")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; text: string; kind: string };
    return { ok: true, id: r.id, text: r.text, kind: r.kind };
  },
});

export const listReflectionsTool = defineTool({
  name: "list_reflections",
  description: [
    "List the user's reflections, newest first. Optional kind filter and",
    "since (ISO date — filter to reflections created on or after).",
    "Use when the user says 'what did I learn this week', 'what regrets",
    "have I logged', or before composing a weekly review.",
  ].join("\n"),
  schema: z.object({
    kind: z.enum(KINDS).optional(),
    since: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional().default(40),
  }),
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...KINDS] },
      since: { type: "string", description: "ISO date — only reflections from this date onward" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 40;
    let q = ctx.supabase
      .from("reflections")
      .select("id, text, kind, tags, created_at")
      .eq("user_id", ctx.userId);
    if (input.kind) q = q.eq("kind", input.kind);
    if (input.since) q = q.gte("created_at", input.since);
    q = q.order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as ReflectionRow[];
    return {
      ok: true,
      count: rows.length,
      reflections: rows.map((r) => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        tags: r.tags,
        kept_at: r.created_at,
      })),
    };
  },
});
