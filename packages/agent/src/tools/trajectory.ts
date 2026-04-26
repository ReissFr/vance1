// Brain tools for trajectory projection — where the user lands at 6 and
// 12 months IF they don't change course. Use when the user asks "where
// am I heading", "if I keep going at this pace", "project me forward",
// "what does six months from now look like", or before any major
// decision (so the user sees what they'd be diverging from).

import { z } from "zod";
import { defineTool } from "./types";

type TrajectoryRow = {
  id: string;
  body_6m: string;
  body_12m: string;
  key_drivers: string[];
  assumptions: string[];
  confidence: number;
  source_counts: Record<string, number>;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
};

export const projectTrajectoryTool = defineTool({
  name: "project_trajectory",
  description: [
    "Run a fresh trajectory projection — generates a 6-month and",
    "12-month narrative of where the user is heading IF they continue",
    "at the current rate. Grounded in their open goals, active themes,",
    "active policies, open predictions, recent wins/reflections,",
    "intention completion rate. No params.",
    "",
    "Use when the user asks 'where am I heading', 'what does my next",
    "year look like at this rate', 'project me forward', or before a",
    "big decision so they see what current-self would extrapolate to.",
  ].join("\n"),
  schema: z.object({}).strict(),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (ctx.supabase as unknown as { rest: { headers: Record<string, string> } }).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /trajectories and tap Run projection" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/trajectories/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `projection failed (${r.status}): ${err.slice(0, 200)}` };
    }
    const j = (await r.json()) as { trajectory?: TrajectoryRow };
    if (!j.trajectory) return { ok: false, error: "no trajectory returned" };
    return {
      ok: true,
      id: j.trajectory.id,
      confidence: j.trajectory.confidence,
      key_drivers: j.trajectory.key_drivers,
      assumptions: j.trajectory.assumptions,
      body_6m: j.trajectory.body_6m,
      body_12m: j.trajectory.body_12m,
    };
  },
});

export const listTrajectoriesTool = defineTool({
  name: "list_trajectories",
  description: [
    "List the user's stored trajectory projections (newest first).",
    "Optional: status (active | pinned | archived | all, default active);",
    "limit (default 10).",
    "",
    "Each entry has body_6m, body_12m, key_drivers, assumptions,",
    "confidence, and the date it was generated. Use to compare older",
    "projections against current reality, or to surface a pinned",
    "projection the user wants to keep weighing decisions against.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "pinned", "archived", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "pinned", "archived", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 10;
    let q = ctx.supabase
      .from("trajectories")
      .select("id, body_6m, body_12m, key_drivers, assumptions, confidence, source_counts, pinned, archived_at, created_at")
      .eq("user_id", ctx.userId);
    if (status === "active") q = q.is("archived_at", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
    q = q.order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as TrajectoryRow[];
    return {
      ok: true,
      count: rows.length,
      trajectories: rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        confidence: r.confidence,
        pinned: r.pinned,
        archived_at: r.archived_at,
        key_drivers: r.key_drivers,
        assumptions: r.assumptions,
        source_counts: r.source_counts,
        body_6m: r.body_6m,
        body_12m: r.body_12m,
      })),
    };
  },
});
