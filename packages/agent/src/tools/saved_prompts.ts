// Brain tools for the saved-prompts library. The user keeps a personal
// library of reusable instructions ("friday-recap", "cold-outreach-template",
// "investor-update-skeleton") and the brain can save, list, fetch, and delete
// by name. fetch_saved_prompt also stamps last_used_at so the library learns
// which prompts get used most.

import { z } from "zod";
import { defineTool } from "./types";

type PromptRow = {
  id: string;
  name: string;
  body: string;
  description: string | null;
  tags: string[];
  use_count: number;
  last_used_at: string | null;
};

export const saveSavedPromptTool = defineTool({
  name: "save_prompt",
  description: [
    "Save a reusable prompt to the user's personal library. Required: name",
    "(slug-style, ≤80 chars) and body (the actual instructions, ≤8000 chars).",
    "Optional: description, tags. Upserts on (user_id, name) — saving with",
    "the same name overwrites the body so the user can iterate.",
    "",
    "Use when the user says 'save this prompt as X', 'remember this template',",
    "or after they've typed a long instruction the third time. Different from",
    "save_memory (passive context) and skills (runnable code) — these are",
    "command templates the user fires by name.",
  ].join("\n"),
  schema: z.object({
    name: z.string().min(1).max(80),
    body: z.string().min(2).max(8000),
    description: z.string().max(400).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["name", "body"],
    properties: {
      name: { type: "string", description: "Slug-style identifier (e.g. friday-recap)" },
      body: { type: "string", description: "The actual prompt text" },
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("saved_prompts")
      .upsert(
        {
          user_id: ctx.userId,
          name: input.name.trim().slice(0, 80),
          body: input.body.trim().slice(0, 8000),
          description: input.description?.trim().slice(0, 400) || null,
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

export const listSavedPromptsTool = defineTool({
  name: "list_saved_prompts",
  description: [
    "List the user's saved prompts. Optional: q (fuzzy search across name,",
    "body, description), tag (exact tag match). Sorted by last_used_at desc",
    "so most-recently-used surface first.",
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
      .from("saved_prompts")
      .select("id, name, body, description, tags, use_count, last_used_at")
      .eq("user_id", ctx.userId);
    if (input.q && input.q.trim()) {
      const needle = input.q.trim().slice(0, 80);
      q = q.or(`name.ilike.%${needle}%,body.ilike.%${needle}%,description.ilike.%${needle}%`);
    }
    if (input.tag) q = q.contains("tags", [input.tag]);
    q = q
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as PromptRow[];
    return {
      ok: true,
      count: rows.length,
      prompts: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        tags: r.tags,
        body_preview: r.body.slice(0, 200),
        use_count: r.use_count,
        last_used_at: r.last_used_at,
      })),
    };
  },
});

export const fetchSavedPromptTool = defineTool({
  name: "fetch_saved_prompt",
  description: [
    "Fetch the full body of a saved prompt by name (exact, case-insensitive).",
    "Stamps last_used_at + increments use_count so the library learns which",
    "prompts get used most. Returns the full body text — caller is expected",
    "to either execute it directly or pass it to start_errand.",
    "",
    "Use when the user says 'run my X prompt', 'fire the X template',",
    "'use my X recipe' — fetch first, then act on the body.",
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
      .from("saved_prompts")
      .select("id, name, body, description, tags, use_count")
      .eq("user_id", ctx.userId)
      .ilike("name", trimmed)
      .limit(2);
    let row = (matches ?? [])[0] as
      | { id: string; name: string; body: string; description: string | null; tags: string[]; use_count: number }
      | undefined;
    if (!row) {
      const { data: fuzzy } = await ctx.supabase
        .from("saved_prompts")
        .select("id, name, body, description, tags, use_count")
        .eq("user_id", ctx.userId)
        .ilike("name", `%${trimmed}%`)
        .limit(5);
      const candidates = (fuzzy ?? []) as Array<{
        id: string;
        name: string;
        body: string;
        description: string | null;
        tags: string[];
        use_count: number;
      }>;
      if (candidates.length === 0) return { ok: false, error: `no prompt named '${trimmed}'` };
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
      .from("saved_prompts")
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
      body: row.body,
    };
  },
});

export const deleteSavedPromptTool = defineTool({
  name: "delete_saved_prompt",
  description: "Delete a saved prompt by name (exact, case-insensitive).",
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
      .from("saved_prompts")
      .select("id, name")
      .eq("user_id", ctx.userId)
      .ilike("name", input.name.trim())
      .maybeSingle();
    if (!row) return { ok: false, error: `no prompt named '${input.name.trim()}'` };
    const r = row as { id: string; name: string };
    const { error } = await ctx.supabase
      .from("saved_prompts")
      .delete()
      .eq("id", r.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, deleted: r.name };
  },
});
