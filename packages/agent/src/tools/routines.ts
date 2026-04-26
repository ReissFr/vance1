// Brain tools for the routines library — named ordered checklists. The user
// keeps reusable multi-step procedures ("morning-publish", "pre-meeting-prep",
// "post-launch-checklist") and the brain can save, list, fetch, and delete by
// name. fetch_routine stamps last_used_at + increments use_count so the
// library learns which routines run most. Distinct from saved_prompts (single
// text template, no order) and skills (executable code) — routines are
// human-paced ordered steps the brain walks through in conversation.

import { z } from "zod";
import { defineTool } from "./types";

type RoutineRow = {
  id: string;
  name: string;
  description: string | null;
  steps: string[];
  tags: string[];
  use_count: number;
  last_used_at: string | null;
};

export const saveRoutineTool = defineTool({
  name: "save_routine",
  description: [
    "Save a named ordered checklist to the user's library. Required: name",
    "(slug-style, ≤80 chars) and steps (1-40 entries, each ≤400 chars).",
    "Optional: description, tags. Upserts on (user_id, name) so re-saving",
    "with the same name overwrites the step list.",
    "",
    "Use when the user says 'save this as my X routine' or after they walk",
    "through the same multi-step procedure repeatedly. Different from",
    "save_prompt (single text template) and skills (runnable code) — these",
    "are human-paced ordered steps.",
  ].join("\n"),
  schema: z.object({
    name: z.string().min(1).max(80),
    steps: z.array(z.string().min(1).max(400)).min(1).max(40),
    description: z.string().max(600).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["name", "steps"],
    properties: {
      name: { type: "string", description: "Slug-style identifier (e.g. morning-publish)" },
      steps: { type: "array", items: { type: "string" }, description: "Ordered list of steps" },
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("routines")
      .upsert(
        {
          user_id: ctx.userId,
          name: input.name.trim().slice(0, 80),
          description: input.description?.trim().slice(0, 600) || null,
          steps: input.steps.map((s) => s.trim().slice(0, 400)).filter(Boolean),
          tags: input.tags ?? [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,name" },
      )
      .select("id, name")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; name: string };
    return { ok: true, id: r.id, name: r.name };
  },
});

export const listRoutinesTool = defineTool({
  name: "list_routines",
  description: [
    "List the user's named routines. Optional: q (fuzzy search across name +",
    "description), tag (exact tag match). Sorted by last_used_at desc so",
    "most-recently-run surface first. Returns name, description, step count,",
    "tags, and use stats per row — fetch_routine to get the full step list.",
  ].join("\n"),
  schema: z.object({
    q: z.string().max(80).optional(),
    tag: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string" },
      tag: { type: "string" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 30;
    let q = ctx.supabase
      .from("routines")
      .select("id, name, description, steps, tags, use_count, last_used_at")
      .eq("user_id", ctx.userId);
    if (input.q && input.q.trim()) {
      const needle = input.q.trim().slice(0, 80);
      q = q.or(`name.ilike.%${needle}%,description.ilike.%${needle}%`);
    }
    if (input.tag) q = q.contains("tags", [input.tag]);
    q = q
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as RoutineRow[];
    return {
      ok: true,
      count: rows.length,
      routines: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        tags: r.tags,
        step_count: r.steps.length,
        use_count: r.use_count,
        last_used_at: r.last_used_at,
      })),
    };
  },
});

export const fetchRoutineTool = defineTool({
  name: "fetch_routine",
  description: [
    "Fetch the full step list of a routine by name (exact, case-insensitive,",
    "with %name% fuzzy fallback). Stamps last_used_at + increments use_count",
    "so the library learns which routines run most. Returns ordered steps —",
    "the brain should walk the user through them or chain them via task tools.",
    "",
    "Use when the user says 'run my X routine', 'walk me through X', or",
    "'fire my X checklist'. If multiple fuzzy matches, returns ambiguous.",
  ].join("\n"),
  schema: z.object({
    name: z.string().min(1).max(80),
  }),
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  },
  async run(input, ctx) {
    const trimmed = input.name.trim();
    const { data: matches } = await ctx.supabase
      .from("routines")
      .select("id, name, description, steps, tags, use_count")
      .eq("user_id", ctx.userId)
      .ilike("name", trimmed)
      .limit(2);
    let row = (matches ?? [])[0] as
      | {
          id: string;
          name: string;
          description: string | null;
          steps: string[];
          tags: string[];
          use_count: number;
        }
      | undefined;
    if (!row) {
      const { data: fuzzy } = await ctx.supabase
        .from("routines")
        .select("id, name, description, steps, tags, use_count")
        .eq("user_id", ctx.userId)
        .ilike("name", `%${trimmed}%`)
        .limit(5);
      const candidates = (fuzzy ?? []) as Array<{
        id: string;
        name: string;
        description: string | null;
        steps: string[];
        tags: string[];
        use_count: number;
      }>;
      if (candidates.length === 0) return { ok: false, error: `no routine named '${trimmed}'` };
      if (candidates.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: candidates.map((c) => ({ name: c.name, description: c.description })),
        };
      }
      row = candidates[0]!;
    }

    await ctx.supabase
      .from("routines")
      .update({
        use_count: row.use_count + 1,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", ctx.userId);

    return {
      ok: true,
      name: row.name,
      description: row.description,
      tags: row.tags,
      steps: row.steps,
    };
  },
});

export const deleteRoutineTool = defineTool({
  name: "delete_routine",
  description: "Delete a routine by name (exact, case-insensitive).",
  schema: z.object({
    name: z.string().min(1).max(80),
  }),
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  },
  async run(input, ctx) {
    const { data: row } = await ctx.supabase
      .from("routines")
      .select("id, name")
      .eq("user_id", ctx.userId)
      .ilike("name", input.name.trim())
      .maybeSingle();
    if (!row) return { ok: false, error: `no routine named '${input.name.trim()}'` };
    const r = row as { id: string; name: string };
    const { error } = await ctx.supabase
      .from("routines")
      .delete()
      .eq("id", r.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, deleted: r.name };
  },
});
