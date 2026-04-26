// Brain tools for the user's Living Constitution — versioned personal
// operating manual distilled from their own policies + identity claims
// + recent decisions + active themes + current trajectory. Each clause
// cites the source it was distilled from. Use BEFORE making any
// non-trivial decision, draft, or action on the user's behalf so the
// brain operates from the user's own laws, not generic best-practice.

import { z } from "zod";
import { defineTool } from "./types";

type ArticleKind = "identity" | "value" | "refuse" | "how_i_work" | "how_i_decide" | "what_im_building";

type ArticleRow = {
  kind: ArticleKind;
  title: string;
  body: string;
  citations: Array<{ kind: string; id: string }>;
};

type ConstitutionRow = {
  id: string;
  version: number;
  parent_id: string | null;
  preamble: string | null;
  body: string;
  articles: ArticleRow[];
  source_counts: Record<string, number>;
  diff_summary: string | null;
  is_current: boolean;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  created_at: string;
};

export const generateConstitutionTool = defineTool({
  name: "generate_constitution",
  description: [
    "Distil the user's CURRENT active policies, identity claims (value",
    "+ refuse + identity kinds), recent decisions, active themes, and",
    "latest trajectory into a versioned Living Constitution. Each",
    "article cites the source it was distilled from.",
    "",
    "On success the new version becomes is_current=true; the previous",
    "current is demoted but kept as history (versioned). Returns",
    "version, article count, diff_summary (what shifted from last",
    "version), and a short preview.",
    "",
    "Use when the user says 'regenerate my constitution', 'update my",
    "operating manual', 'redo my laws', or after they've added several",
    "new policies / identity claims / decisions and want the constitution",
    "refreshed.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (ctx.supabase as unknown as { rest: { headers: Record<string, string> } }).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /constitution and tap Regenerate" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/constitutions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `generate failed (${r.status}): ${err.slice(0, 200)}` };
    }
    const j = (await r.json()) as { constitution?: ConstitutionRow };
    const c = j.constitution;
    if (!c) return { ok: false, error: "no constitution returned" };
    return {
      ok: true,
      id: c.id,
      version: c.version,
      articles: (c.articles ?? []).length,
      diff_summary: c.diff_summary,
      preamble: c.preamble,
      preview: c.body.slice(0, 600),
    };
  },
});

export const getLatestConstitutionTool = defineTool({
  name: "get_latest_constitution",
  description: [
    "Read the user's current Living Constitution — their own laws,",
    "distilled from their own data. Returns articles grouped by kind",
    "(identity / value / refuse / how_i_work / how_i_decide /",
    "what_im_building) with citations.",
    "",
    "Use BEFORE drafting on the user's behalf, scheduling for them,",
    "making spend decisions, replying to people, accepting commitments,",
    "or any non-trivial action. The constitution is what the user has",
    "explicitly declared — if your action contradicts an article, flag",
    "it before proceeding.",
    "",
    "Optional: include_body (default false — when true returns full",
    "markdown body too).",
  ].join("\n"),
  schema: z.object({
    include_body: z.boolean().optional().default(false),
  }),
  inputSchema: {
    type: "object",
    properties: {
      include_body: { type: "boolean" },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("constitutions")
      .select("id, version, preamble, body, articles, diff_summary, source_counts, is_current, pinned, created_at")
      .eq("user_id", ctx.userId)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) {
      return {
        ok: true,
        exists: false,
        note: "the user has no constitution drafted yet — suggest they open /constitution and regenerate, or call generate_constitution",
      };
    }
    const row = data as ConstitutionRow;
    const articles = Array.isArray(row.articles) ? row.articles : [];
    const grouped: Record<ArticleKind, Array<{ title: string; body: string; citations: number }>> = {
      identity: [], value: [], refuse: [], how_i_work: [], how_i_decide: [], what_im_building: [],
    };
    for (const a of articles) {
      if (!a || !grouped[a.kind]) continue;
      grouped[a.kind].push({
        title: a.title,
        body: a.body,
        citations: Array.isArray(a.citations) ? a.citations.length : 0,
      });
    }
    return {
      ok: true,
      exists: true,
      id: row.id,
      version: row.version,
      pinned: row.pinned,
      created_at: row.created_at,
      preamble: row.preamble,
      articles_by_kind: grouped,
      total_articles: articles.length,
      ...(input.include_body ? { body: row.body } : {}),
    };
  },
});

export const listConstitutionVersionsTool = defineTool({
  name: "list_constitution_versions",
  description: [
    "List the user's stored Living Constitution versions newest first,",
    "so you can reference how their constitution has shifted over time",
    "or read a specific past version.",
    "",
    "Optional: limit (default 10).",
    "",
    "Use when the user asks 'show me my old constitution', 'how has my",
    "constitution shifted', 'what did v2 say'.",
  ].join("\n"),
  schema: z.object({
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number" } },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 10;
    const { data, error } = await ctx.supabase
      .from("constitutions")
      .select("id, version, parent_id, diff_summary, is_current, pinned, archived_at, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<{
      id: string; version: number; parent_id: string | null; diff_summary: string | null;
      is_current: boolean; pinned: boolean; archived_at: string | null; created_at: string;
    }>;
    return {
      ok: true,
      count: rows.length,
      versions: rows.map((r) => ({
        id: r.id,
        version: r.version,
        parent_id: r.parent_id,
        diff_summary: r.diff_summary,
        is_current: r.is_current,
        pinned: r.pinned,
        archived: !!r.archived_at,
        created_at: r.created_at,
      })),
    };
  },
});
