// Brain tools for the goals system. Goals are the longer-horizon objectives
// that intentions and wins ladder up to.

import { z } from "zod";
import { defineTool } from "./types";

type Milestone = { text: string; done_at: string | null };
type GoalRow = {
  id: string;
  title: string;
  why: string | null;
  kind: string;
  target_date: string | null;
  status: string;
  progress_pct: number;
  milestones: Milestone[];
  completed_at: string | null;
};

export const addGoalTool = defineTool({
  name: "add_goal",
  description: [
    "Create a new goal. Required: title. Optional: why (motivation),",
    "kind ('quarterly' default | 'monthly' | 'yearly' | 'custom'),",
    "target_date (ISO YYYY-MM-DD), milestones (array of strings).",
    "",
    "Use when the user says: 'my goal this quarter is X', 'I want to hit Y",
    "by Z', 'add a goal for me'.",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(2).max(200),
    why: z.string().max(1000).optional(),
    kind: z.enum(["quarterly", "monthly", "yearly", "custom"]).optional().default("quarterly"),
    target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    milestones: z.array(z.string().min(1).max(200)).max(30).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      why: { type: "string" },
      kind: { type: "string", enum: ["quarterly", "monthly", "yearly", "custom"] },
      target_date: { type: "string", description: "YYYY-MM-DD" },
      milestones: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const milestones: Milestone[] = (input.milestones ?? []).map((t) => ({
      text: t.trim().slice(0, 200),
      done_at: null,
    }));
    const { data, error } = await ctx.supabase
      .from("goals")
      .insert({
        user_id: ctx.userId,
        title: input.title.trim().slice(0, 200),
        why: input.why?.trim().slice(0, 1000) || null,
        kind: input.kind ?? "quarterly",
        target_date: input.target_date ?? null,
        milestones,
      })
      .select("id, title, target_date")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; title: string; target_date: string | null };
    return { ok: true, id: r.id, title: r.title, target_date: r.target_date };
  },
});

export const listGoalsTool = defineTool({
  name: "list_goals",
  description: [
    "List the user's goals filtered by status: 'active' (default), 'done',",
    "'dropped', or 'all'. Returns title, why, kind, target_date, progress_pct,",
    "milestones (with done state), completed_at.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "done", "dropped", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "done", "dropped", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 20;
    let q = ctx.supabase
      .from("goals")
      .select("id, title, why, kind, target_date, status, progress_pct, milestones, completed_at")
      .eq("user_id", ctx.userId);
    if (status !== "all") q = q.eq("status", status);
    q = q.order("target_date", { ascending: true, nullsFirst: false }).limit(limit);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as GoalRow[];
    return {
      ok: true,
      count: rows.length,
      goals: rows.map((r) => ({
        id: r.id,
        title: r.title,
        why: r.why,
        kind: r.kind,
        target_date: r.target_date,
        status: r.status,
        progress_pct: r.progress_pct,
        milestone_count: r.milestones.length,
        milestones_done: r.milestones.filter((m) => m.done_at).length,
        milestones: r.milestones,
        completed_at: r.completed_at,
      })),
    };
  },
});

async function findOpenGoalByTitle(
  ctx: { supabase: GoalRow extends never ? never : import("@supabase/supabase-js").SupabaseClient; userId: string },
  title: string,
): Promise<
  | { ok: true; goal: GoalRow }
  | { ok: false; error?: string; ambiguous?: true; candidates?: Array<{ id: string; title: string }> }
> {
  const { data } = await ctx.supabase
    .from("goals")
    .select("id, title, why, kind, target_date, status, progress_pct, milestones, completed_at")
    .eq("user_id", ctx.userId)
    .eq("status", "active")
    .ilike("title", `%${title}%`)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = (data ?? []) as GoalRow[];
  if (rows.length === 0) return { ok: false, error: "no active goal matches that title" };
  if (rows.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      candidates: rows.map((r) => ({ id: r.id, title: r.title })),
    };
  }
  return { ok: true, goal: rows[0]! };
}

export const updateGoalTool = defineTool({
  name: "update_goal",
  description: [
    "Update an existing goal. Identify by id (preferred — from list_goals)",
    "or by partial title (fuzzy match across active goals only). Operations:",
    "- progress_pct (0-100)",
    "- add_milestone: append a new milestone",
    "- complete_milestone: index OR text — flips done_at on a milestone",
    "- status: 'done' | 'dropped' | 'active'",
    "",
    "If the title matches multiple active goals, returns ambiguous=true",
    "with candidates.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid().optional(),
    title: z.string().min(2).max(200).optional(),
    progress_pct: z.number().int().min(0).max(100).optional(),
    add_milestone: z.string().min(1).max(200).optional(),
    complete_milestone_index: z.number().int().min(0).optional(),
    complete_milestone_text: z.string().min(1).max(200).optional(),
    status: z.enum(["active", "done", "dropped"]).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      progress_pct: { type: "number" },
      add_milestone: { type: "string" },
      complete_milestone_index: { type: "number" },
      complete_milestone_text: { type: "string" },
      status: { type: "string", enum: ["active", "done", "dropped"] },
    },
  },
  async run(input, ctx) {
    let goal: GoalRow | null = null;
    if (input.id) {
      const { data } = await ctx.supabase
        .from("goals")
        .select("id, title, why, kind, target_date, status, progress_pct, milestones, completed_at")
        .eq("id", input.id)
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (!data) return { ok: false, error: "goal not found" };
      goal = data as GoalRow;
    } else if (input.title) {
      const found = await findOpenGoalByTitle(ctx, input.title);
      if (!found.ok) return found;
      goal = found.goal;
    } else {
      return { ok: false, error: "id or title required" };
    }

    const patch: Record<string, unknown> = {};
    let milestones = [...goal.milestones];
    let milestonesChanged = false;

    if (input.add_milestone) {
      milestones.push({ text: input.add_milestone.trim().slice(0, 200), done_at: null });
      milestonesChanged = true;
    }
    if (typeof input.complete_milestone_index === "number") {
      const idx = input.complete_milestone_index;
      if (idx >= 0 && idx < milestones.length) {
        const existing = milestones[idx]!;
        milestones[idx] = { ...existing, done_at: existing.done_at ? null : new Date().toISOString() };
        milestonesChanged = true;
      }
    }
    if (input.complete_milestone_text) {
      const needle = input.complete_milestone_text.toLowerCase();
      const idx = milestones.findIndex((m) => m.text.toLowerCase().includes(needle));
      if (idx >= 0) {
        const existing = milestones[idx]!;
        milestones[idx] = { ...existing, done_at: existing.done_at ? null : new Date().toISOString() };
        milestonesChanged = true;
      }
    }
    if (milestonesChanged) {
      patch.milestones = milestones;
      const total = milestones.length;
      const done = milestones.filter((m) => m.done_at).length;
      if (total > 0 && input.progress_pct === undefined) {
        patch.progress_pct = Math.round((done / total) * 100);
      }
    }
    if (typeof input.progress_pct === "number") {
      patch.progress_pct = input.progress_pct;
    }
    if (input.status) {
      patch.status = input.status;
      if (input.status === "done") {
        patch.completed_at = new Date().toISOString();
        patch.progress_pct = 100;
      } else if (input.status === "active") {
        patch.completed_at = null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "nothing to update" };
    }
    patch.updated_at = new Date().toISOString();

    const { error } = await ctx.supabase
      .from("goals")
      .update(patch)
      .eq("id", goal.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      id: goal.id,
      title: goal.title,
      progress_pct: typeof patch.progress_pct === "number" ? patch.progress_pct : goal.progress_pct,
      status: typeof patch.status === "string" ? patch.status : goal.status,
    };
  },
});
