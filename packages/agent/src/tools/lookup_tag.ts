// Tag-driven cross-journal lookup. Same parallel-source pattern as
// cross_search but uses `.contains('tags', [tag])` instead of substring match.
// Lets the brain answer "show me everything tagged X" across every journal
// layer that has a `tags text[]` column. Tag filtering is exact-match on
// array membership (PostgREST `cs` operator), case-sensitive — so the user
// or brain has to use the canonical tag spelling.

import { z } from "zod";
import { defineTool } from "./types";

type Hit = {
  kind: string;
  id: string;
  snippet: string;
  date: string | null;
  extra: Record<string, unknown>;
};

export const lookupTagTool = defineTool({
  name: "lookup_tag",
  description: [
    "Pull every entry tagged with a given tag across all tagged journal",
    "layers in one call. Sources hit: decisions, goals, ideas, questions,",
    "reflections, saved_prompts, people, knowledge_cards, routines.",
    "",
    "Use when the user says 'show me everything tagged X', 'what's tagged Y',",
    "'pull all my Z stuff' — one call instead of nine. Tag match is exact,",
    "case-sensitive — if the brain isn't sure of the spelling, list_* tools",
    "first to find the canonical tag.",
  ].join("\n"),
  schema: z.object({
    tag: z.string().min(1).max(40),
    limit_per_kind: z.number().int().min(1).max(50).optional(),
    kinds: z
      .array(
        z.enum([
          "decisions",
          "goals",
          "ideas",
          "questions",
          "reflections",
          "saved_prompts",
          "people",
          "knowledge_cards",
          "routines",
        ]),
      )
      .optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["tag"],
    properties: {
      tag: { type: "string", description: "Exact tag to match (case-sensitive)" },
      limit_per_kind: {
        type: "number",
        description: "Per-source cap (default 10, max 50)",
      },
      kinds: {
        type: "array",
        items: { type: "string" },
        description: "Optional filter — only search these sources",
      },
    },
  },
  async run(input, ctx) {
    const tag = input.tag.trim();
    const limit = input.limit_per_kind ?? 10;
    const allKinds = [
      "decisions",
      "goals",
      "ideas",
      "questions",
      "reflections",
      "saved_prompts",
      "people",
      "knowledge_cards",
      "routines",
    ] as const;
    const want = new Set(input.kinds && input.kinds.length > 0 ? input.kinds : allKinds);

    const promises: Array<PromiseLike<Hit[]>> = [];

    if (want.has("decisions")) {
      promises.push(
        ctx.supabase
          .from("decisions")
          .select("id, title, choice, outcome_label, reviewed_at, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              title: string;
              choice: string;
              outcome_label: string | null;
              reviewed_at: string | null;
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "decisions",
              id: r.id,
              snippet: `${r.title} → ${r.choice}`,
              date: r.created_at,
              extra: { outcome_label: r.outcome_label, reviewed: r.reviewed_at != null },
            })),
          ),
      );
    }

    if (want.has("goals")) {
      promises.push(
        ctx.supabase
          .from("goals")
          .select("id, title, target_date, progress_pct, status, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              title: string;
              target_date: string | null;
              progress_pct: number | null;
              status: string;
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "goals",
              id: r.id,
              snippet: r.title,
              date: r.created_at,
              extra: {
                target_date: r.target_date,
                progress_pct: r.progress_pct,
                status: r.status,
              },
            })),
          ),
      );
    }

    if (want.has("ideas")) {
      promises.push(
        ctx.supabase
          .from("ideas")
          .select("id, text, kind, heat, status, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              kind: string | null;
              heat: number | null;
              status: string | null;
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "ideas",
              id: r.id,
              snippet: r.text,
              date: r.created_at,
              extra: { subkind: r.kind, heat: r.heat, status: r.status },
            })),
          ),
      );
    }

    if (want.has("questions")) {
      promises.push(
        ctx.supabase
          .from("questions")
          .select("id, text, kind, status, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              kind: string | null;
              status: string | null;
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "questions",
              id: r.id,
              snippet: r.text,
              date: r.created_at,
              extra: { subkind: r.kind, status: r.status },
            })),
          ),
      );
    }

    if (want.has("reflections")) {
      promises.push(
        ctx.supabase
          .from("reflections")
          .select("id, text, kind, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              kind: string;
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "reflections",
              id: r.id,
              snippet: r.text,
              date: r.created_at,
              extra: { subkind: r.kind },
            })),
          ),
      );
    }

    if (want.has("saved_prompts")) {
      promises.push(
        ctx.supabase
          .from("saved_prompts")
          .select("id, name, body, description, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              name: string;
              body: string;
              description: string | null;
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "saved_prompts",
              id: r.id,
              snippet: `${r.name}: ${r.body.slice(0, 200)}`,
              date: r.created_at,
              extra: { name: r.name, description: r.description },
            })),
          ),
      );
    }

    if (want.has("people")) {
      promises.push(
        ctx.supabase
          .from("people")
          .select("id, name, relation, role, company, last_interaction_at, tags")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("last_interaction_at", { ascending: false, nullsFirst: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              name: string;
              relation: string;
              role: string | null;
              company: string | null;
              last_interaction_at: string | null;
              tags: string[];
            }>).map((r) => ({
              kind: "people",
              id: r.id,
              snippet: `${r.name}${r.role ? ` · ${r.role}` : ""}${r.company ? ` @ ${r.company}` : ""}`,
              date: r.last_interaction_at,
              extra: { relation: r.relation },
            })),
          ),
      );
    }

    if (want.has("knowledge_cards")) {
      promises.push(
        ctx.supabase
          .from("knowledge_cards")
          .select("id, claim, source, kind, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              claim: string;
              source: string | null;
              kind: string;
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "knowledge_cards",
              id: r.id,
              snippet: r.claim,
              date: r.created_at,
              extra: { subkind: r.kind, source: r.source },
            })),
          ),
      );
    }

    if (want.has("routines")) {
      promises.push(
        ctx.supabase
          .from("routines")
          .select("id, name, description, steps, tags, created_at")
          .eq("user_id", ctx.userId)
          .contains("tags", [tag])
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              name: string;
              description: string | null;
              steps: string[];
              tags: string[];
              created_at: string;
            }>).map((r) => ({
              kind: "routines",
              id: r.id,
              snippet: `${r.name}${r.description ? ` — ${r.description}` : ""}`,
              date: r.created_at,
              extra: { name: r.name, step_count: r.steps.length },
            })),
          ),
      );
    }

    const results = await Promise.all(promises);
    const all: Hit[] = results.flat();
    all.sort((a, b) => {
      const da = a.date ?? "";
      const db = b.date ?? "";
      if (da === db) return 0;
      return da < db ? 1 : -1;
    });

    const counts: Record<string, number> = {};
    for (const h of all) counts[h.kind] = (counts[h.kind] ?? 0) + 1;

    return {
      ok: true,
      tag,
      total: all.length,
      counts,
      hits: all,
    };
  },
});
