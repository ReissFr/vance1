// Brain tools for Soul Cartography. The user's identity claims, themes,
// policies, goals, recent decisions, and important people are pulled into
// a graph and Haiku infers the load-bearing edges (supports / tension /
// shapes / anchors / connects). Each map is a snapshot — drawing a fresh
// one creates a new row whose drift_summary contrasts it with the previous.
//
// Use these tools when the user says things like "show me the map of
// who I am right now", "what's load-bearing in my life", "where are the
// tensions between what I value and what I'm doing", "draw a soul map",
// "compare my map to last quarter", or as the closing of a heavy
// reflection cycle.

import { z } from "zod";
import { defineTool } from "./types";

type Node = {
  id: string;
  kind: "identity" | "theme" | "policy" | "goal" | "decision" | "person";
  subkind?: string | null;
  label: string;
  weight: number;
  ref_id: string;
};

type Edge = {
  source: string;
  target: string;
  relation: "supports" | "tension" | "shapes" | "anchors" | "connects";
  strength: number;
  note: string;
};

type SoulMapRow = {
  id: string;
  nodes: Node[];
  edges: Edge[];
  centroid_summary: string | null;
  drift_summary: string | null;
  source_counts: Record<string, number>;
  parent_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  created_at: string;
};

export const drawSoulMapTool = defineTool({
  name: "draw_soul_map",
  description: [
    "Draw a fresh soul-map — a graph of how the user's stated identity,",
    "themes, policies, goals, recent decisions, and important people",
    "relate to each other via supports / tension / shapes / anchors /",
    "connects edges. Each fresh map is dated and includes a centroid",
    "paragraph + (if there's a previous map) a one-sentence drift",
    "summary contrasting this snapshot with the previous one.",
    "",
    "Optional: decision_window_days (14-365, default 90) — how far back",
    "to pull recent decisions for the graph.",
    "",
    "Use this when the user says 'draw my soul map', 'show me the shape",
    "of who I am', 'what's load-bearing right now', 'where are the",
    "tensions in my life', or as the closing of a heavy reflection",
    "cycle. Don't run this casually — it's expensive and the snapshot",
    "is dated, so call once per meaningful interval.",
    "",
    "Returns the new map's id, centroid, drift, and a preview of the",
    "strongest edges.",
  ].join("\n"),
  schema: z.object({
    decision_window_days: z.number().int().min(14).max(365).optional().default(90),
  }),
  inputSchema: {
    type: "object",
    properties: { decision_window_days: { type: "number" } },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/soul-maps`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ decision_window_days: input.decision_window_days ?? 90 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `draw failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { map?: SoulMapRow };
    if (!j.map) return { ok: false, error: "no map produced" };

    const nodeById = new Map(j.map.nodes.map((n) => [n.id, n]));
    const topEdges = [...j.map.edges]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 8)
      .map((e) => ({
        from: nodeById.get(e.source)?.label ?? e.source,
        to: nodeById.get(e.target)?.label ?? e.target,
        relation: e.relation,
        strength: e.strength,
        note: e.note,
      }));

    return {
      ok: true,
      map: {
        id: j.map.id,
        node_count: j.map.nodes.length,
        edge_count: j.map.edges.length,
        centroid_summary: j.map.centroid_summary,
        drift_summary: j.map.drift_summary,
        source_counts: j.map.source_counts,
        created_at: j.map.created_at,
        top_edges: topEdges,
      },
    };
  },
});

export const listSoulMapsTool = defineTool({
  name: "list_soul_maps",
  description: [
    "List the user's stored soul maps (newest first). Optional: status",
    "(active | pinned | archived | all, default active); limit (default 10).",
    "Returns id, node/edge counts, centroid_summary, drift_summary, and",
    "user_note (the user's own reaction).",
    "",
    "Use when the user references a past map ('that map from January',",
    "'compare my map now to last month'), wants drift over time ('how",
    "has the shape changed'), or before a heavy reflection so the brain",
    "has a current read of the user's inner architecture.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "pinned", "archived", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(40).optional().default(10),
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
      .from("soul_maps")
      .select("id, nodes, edges, centroid_summary, drift_summary, source_counts, parent_id, pinned, archived_at, user_note, created_at")
      .eq("user_id", ctx.userId);
    if (status === "active") q = q.is("archived_at", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
    q = q.order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as SoulMapRow[];
    return {
      ok: true,
      count: rows.length,
      maps: rows.map((r) => ({
        id: r.id,
        node_count: (r.nodes ?? []).length,
        edge_count: (r.edges ?? []).length,
        centroid_summary: r.centroid_summary,
        drift_summary: r.drift_summary,
        source_counts: r.source_counts,
        pinned: r.pinned,
        user_note: r.user_note,
        created_at: r.created_at,
      })),
    };
  },
});
