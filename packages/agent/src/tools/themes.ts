// Brain tools for themes — narrative threads spanning weeks or months. A
// theme is a story arc the user wants JARVIS to keep tracking ("ending the
// agency", "Lisbon move", "peptide research training"). Distinct from goals
// (specific measurable outcome + target date) and decisions (committed past
// choice). Themes have a mutable `current_state` field the brain updates as
// the story evolves, and an optional `outcome` when closed.

import { z } from "zod";
import { defineTool } from "./types";

const VALID_KINDS = [
  "work",
  "personal",
  "health",
  "relationships",
  "learning",
  "creative",
  "other",
] as const;
const VALID_STATUSES = ["active", "paused", "closed"] as const;

type ThemeRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  description: string | null;
  current_state: string | null;
  outcome: string | null;
  closed_at: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export const saveThemeTool = defineTool({
  name: "save_theme",
  description: [
    "Save or update a narrative theme — a story arc the user wants JARVIS",
    "to keep tracking across weeks or months. Required: title. Optional:",
    "kind (work/personal/health/relationships/learning/creative/other,",
    "default work), description (static framing), current_state (mutable",
    "'where am I now' note — update as the story evolves), tags.",
    "",
    "Upserts on (user_id, title) so re-saving with the same title updates",
    "in place. Use when the user introduces a new ongoing thread they want",
    "you to track, or when you notice a recurring topic that deserves its",
    "own arc. Distinct from goals (measurable target+date) and decisions",
    "(past committed choice).",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(1).max(120),
    kind: z.enum(VALID_KINDS).optional(),
    description: z.string().max(2000).optional(),
    current_state: z.string().max(4000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      kind: {
        type: "string",
        enum: [...VALID_KINDS],
      },
      description: { type: "string", description: "Static framing — what is this theme about" },
      current_state: { type: "string", description: "Mutable note — where the user is right now" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("themes")
      .upsert(
        {
          user_id: ctx.userId,
          title: input.title.trim().slice(0, 120),
          kind: input.kind ?? "work",
          description: input.description?.trim().slice(0, 2000) || null,
          current_state: input.current_state?.trim().slice(0, 4000) || null,
          tags: input.tags ?? [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,title" },
      )
      .select("id, title, kind, status")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; title: string; kind: string; status: string };
    return { ok: true, id: r.id, title: r.title, kind: r.kind, status: r.status };
  },
});

export const updateThemeStateTool = defineTool({
  name: "update_theme_state",
  description: [
    "Update the mutable `current_state` narrative of an existing theme. Use",
    "this whenever the user gives an update on a theme they're living through",
    "('quick update on the Lisbon move: flat is signed but shipping delayed').",
    "Matches by title (exact case-insensitive, %title% fuzzy fallback).",
    "Overwrites the prior state — if you need to preserve history, include",
    "dated markers in the new text.",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(1).max(120),
    current_state: z.string().min(1).max(4000),
  }),
  inputSchema: {
    type: "object",
    required: ["title", "current_state"],
    properties: {
      title: { type: "string" },
      current_state: { type: "string" },
    },
  },
  async run(input, ctx) {
    const trimmed = input.title.trim();
    const { data: matches } = await ctx.supabase
      .from("themes")
      .select("id, title")
      .eq("user_id", ctx.userId)
      .ilike("title", trimmed)
      .limit(2);
    let row = (matches ?? [])[0] as { id: string; title: string } | undefined;
    if (!row) {
      const { data: fuzzy } = await ctx.supabase
        .from("themes")
        .select("id, title")
        .eq("user_id", ctx.userId)
        .ilike("title", `%${trimmed}%`)
        .limit(5);
      const candidates = (fuzzy ?? []) as Array<{ id: string; title: string }>;
      if (candidates.length === 0) return { ok: false, error: `no theme titled '${trimmed}'` };
      if (candidates.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: candidates.map((c) => ({ title: c.title })),
        };
      }
      row = candidates[0]!;
    }
    const { error } = await ctx.supabase
      .from("themes")
      .update({
        current_state: input.current_state.trim().slice(0, 4000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, title: row.title };
  },
});

export const listThemesTool = defineTool({
  name: "list_themes",
  description: [
    "List the user's themes. Optional: status (active/paused/closed/all,",
    "default active), kind filter. Sorted by updated_at desc so recently-",
    "touched arcs surface first. Returns title, kind, status, description,",
    "current_state, tags, updated_at per row — read this when you want a",
    "snapshot of everything the user is living through right now.",
  ].join("\n"),
  schema: z.object({
    status: z.enum([...VALID_STATUSES, "all"]).optional().default("active"),
    kind: z.enum(VALID_KINDS).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: [...VALID_STATUSES, "all"] },
      kind: { type: "string", enum: [...VALID_KINDS] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 30;
    let q = ctx.supabase
      .from("themes")
      .select("id, title, kind, status, description, current_state, outcome, closed_at, tags, updated_at")
      .eq("user_id", ctx.userId);
    if (status !== "all") q = q.eq("status", status);
    if (input.kind) q = q.eq("kind", input.kind);
    q = q.order("updated_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<Omit<ThemeRow, "created_at">>;
    return {
      ok: true,
      count: rows.length,
      themes: rows.map((r) => ({
        title: r.title,
        kind: r.kind,
        status: r.status,
        description: r.description,
        current_state: r.current_state,
        outcome: r.outcome,
        tags: r.tags,
        updated_at: r.updated_at,
      })),
    };
  },
});

export const getThemeTool = defineTool({
  name: "get_theme",
  description: [
    "Fetch a single theme by title (exact case-insensitive, %title% fuzzy",
    "fallback). Returns the full row including description, current_state,",
    "outcome, closed_at, tags, timestamps. Use when the user references a",
    "specific theme by name and you need full context before responding.",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(1).max(120),
  }),
  inputSchema: {
    type: "object",
    required: ["title"],
    properties: { title: { type: "string" } },
  },
  async run(input, ctx) {
    const trimmed = input.title.trim();
    const { data: matches } = await ctx.supabase
      .from("themes")
      .select("id, title, kind, status, description, current_state, outcome, closed_at, tags, created_at, updated_at")
      .eq("user_id", ctx.userId)
      .ilike("title", trimmed)
      .limit(2);
    let row = (matches ?? [])[0] as ThemeRow | undefined;
    if (!row) {
      const { data: fuzzy } = await ctx.supabase
        .from("themes")
        .select("id, title, kind, status, description, current_state, outcome, closed_at, tags, created_at, updated_at")
        .eq("user_id", ctx.userId)
        .ilike("title", `%${trimmed}%`)
        .limit(5);
      const candidates = (fuzzy ?? []) as ThemeRow[];
      if (candidates.length === 0) return { ok: false, error: `no theme titled '${trimmed}'` };
      if (candidates.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: candidates.map((c) => ({ title: c.title, status: c.status })),
        };
      }
      row = candidates[0]!;
    }
    return {
      ok: true,
      theme: {
        title: row.title,
        kind: row.kind,
        status: row.status,
        description: row.description,
        current_state: row.current_state,
        outcome: row.outcome,
        closed_at: row.closed_at,
        tags: row.tags,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    };
  },
});

export const closeThemeTool = defineTool({
  name: "close_theme",
  description: [
    "Close an active theme — sets status='closed', stamps closed_at, and",
    "records an optional outcome note ('how did this arc end?'). Use when",
    "the user says the thread is resolved ('we moved in', 'I sold the",
    "agency', 'I'm done with this'). Matches by title (exact ilike, fuzzy",
    "fallback). Reopen later via save_theme with the same title if needed.",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(1).max(120),
    outcome: z.string().max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      outcome: { type: "string", description: "How did this arc end?" },
    },
  },
  async run(input, ctx) {
    const trimmed = input.title.trim();
    const { data: matches } = await ctx.supabase
      .from("themes")
      .select("id, title")
      .eq("user_id", ctx.userId)
      .ilike("title", trimmed)
      .limit(2);
    let row = (matches ?? [])[0] as { id: string; title: string } | undefined;
    if (!row) {
      const { data: fuzzy } = await ctx.supabase
        .from("themes")
        .select("id, title")
        .eq("user_id", ctx.userId)
        .ilike("title", `%${trimmed}%`)
        .limit(5);
      const candidates = (fuzzy ?? []) as Array<{ id: string; title: string }>;
      if (candidates.length === 0) return { ok: false, error: `no theme titled '${trimmed}'` };
      if (candidates.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: candidates.map((c) => ({ title: c.title })),
        };
      }
      row = candidates[0]!;
    }
    const outcome = input.outcome?.trim().slice(0, 2000) || null;
    const { error } = await ctx.supabase
      .from("themes")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        outcome,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, closed: row.title, outcome };
  },
});
