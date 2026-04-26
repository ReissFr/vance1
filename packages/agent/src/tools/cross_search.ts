// Single-call cross-journal search. Hits every user-facing journal layer in
// parallel for a substring match and returns ranked hits. Lets the brain
// answer "have I thought about X before?", "did I log anything about Y?",
// "what have I written about Z?" in one call instead of ten.
//
// Sources covered: wins, reflections, decisions, ideas, questions,
// knowledge_cards, saved_prompts, routines, people, intentions, standups,
// reading_list. Every hit is normalised into { kind, id, snippet, date,
// extra }. PostgREST `.or()` with `.ilike()` for fuzzy matches.

import { z } from "zod";
import { defineTool } from "./types";

type Hit = {
  kind: string;
  id: string;
  snippet: string;
  date: string | null;
  extra: Record<string, unknown>;
};

function escapeIlike(needle: string): string {
  // Escape % and _ which are wildcards in LIKE — keep the user's literal
  // string a literal rather than letting them inject patterns.
  return needle.replace(/[%_]/g, (ch) => `\\${ch}`);
}

export const crossSearchTool = defineTool({
  name: "cross_search",
  description: [
    "Search across every journal layer at once for a query string. Hits:",
    "wins, reflections, decisions, ideas, questions, knowledge_cards,",
    "saved_prompts, routines, people, intentions, standups, reading_list.",
    "Returns up to `limit_per_kind` hits per source (default 5, max 20),",
    "merged + sorted by date desc.",
    "",
    "Use when the user asks 'have I thought about X', 'what have I written",
    "about Y', 'did I log anything around Z' — one call instead of ten.",
    "Different from list_* tools which target a single source.",
  ].join("\n"),
  schema: z.object({
    q: z.string().min(2).max(120),
    limit_per_kind: z.number().int().min(1).max(20).optional(),
    kinds: z
      .array(
        z.enum([
          "wins",
          "reflections",
          "decisions",
          "ideas",
          "questions",
          "knowledge_cards",
          "saved_prompts",
          "routines",
          "people",
          "intentions",
          "standups",
          "reading_list",
        ]),
      )
      .optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["q"],
    properties: {
      q: { type: "string", description: "Substring to search for (≥2 chars, ≤120)" },
      limit_per_kind: {
        type: "number",
        description: "Per-source cap (default 5, max 20)",
      },
      kinds: {
        type: "array",
        items: { type: "string" },
        description: "Optional filter — only search these sources",
      },
    },
  },
  async run(input, ctx) {
    const needle = escapeIlike(input.q.trim());
    const pat = `%${needle}%`;
    const limit = input.limit_per_kind ?? 5;
    const allKinds = [
      "wins",
      "reflections",
      "decisions",
      "ideas",
      "questions",
      "knowledge_cards",
      "saved_prompts",
      "routines",
      "people",
      "intentions",
      "standups",
      "reading_list",
    ] as const;
    const want = new Set(input.kinds && input.kinds.length > 0 ? input.kinds : allKinds);

    const promises: Array<PromiseLike<Hit[]>> = [];

    if (want.has("wins")) {
      promises.push(
        ctx.supabase
          .from("wins")
          .select("id, text, kind, amount_cents, created_at")
          .eq("user_id", ctx.userId)
          .ilike("text", pat)
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              kind: string;
              amount_cents: number | null;
              created_at: string;
            }>).map((r) => ({
              kind: "wins",
              id: r.id,
              snippet: r.text,
              date: r.created_at,
              extra: { subkind: r.kind, amount_cents: r.amount_cents },
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
          .ilike("text", pat)
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
              extra: { subkind: r.kind, tags: r.tags },
            })),
          ),
      );
    }

    if (want.has("decisions")) {
      promises.push(
        ctx.supabase
          .from("decisions")
          .select("id, title, choice, context, created_at, reviewed_at, outcome_label")
          .eq("user_id", ctx.userId)
          .or(`title.ilike.${pat},choice.ilike.${pat},context.ilike.${pat}`)
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              title: string;
              choice: string;
              context: string | null;
              created_at: string;
              reviewed_at: string | null;
              outcome_label: string | null;
            }>).map((r) => ({
              kind: "decisions",
              id: r.id,
              snippet: `${r.title} → ${r.choice}`,
              date: r.created_at,
              extra: {
                title: r.title,
                outcome_label: r.outcome_label,
                reviewed: r.reviewed_at != null,
              },
            })),
          ),
      );
    }

    if (want.has("ideas")) {
      promises.push(
        ctx.supabase
          .from("ideas")
          .select("id, text, kind, heat, status, created_at")
          .eq("user_id", ctx.userId)
          .ilike("text", pat)
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              kind: string | null;
              heat: number | null;
              status: string | null;
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
          .select("id, text, kind, status, created_at")
          .eq("user_id", ctx.userId)
          .ilike("text", pat)
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              kind: string | null;
              status: string | null;
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

    if (want.has("knowledge_cards")) {
      promises.push(
        ctx.supabase
          .from("knowledge_cards")
          .select("id, claim, source, kind, tags, created_at")
          .eq("user_id", ctx.userId)
          .or(`claim.ilike.${pat},source.ilike.${pat}`)
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
              extra: { subkind: r.kind, source: r.source, tags: r.tags },
            })),
          ),
      );
    }

    if (want.has("saved_prompts")) {
      promises.push(
        ctx.supabase
          .from("saved_prompts")
          .select("id, name, body, description, created_at")
          .eq("user_id", ctx.userId)
          .or(`name.ilike.${pat},body.ilike.${pat},description.ilike.${pat}`)
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              name: string;
              body: string;
              description: string | null;
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

    if (want.has("routines")) {
      promises.push(
        ctx.supabase
          .from("routines")
          .select("id, name, description, steps, created_at")
          .eq("user_id", ctx.userId)
          .or(`name.ilike.${pat},description.ilike.${pat}`)
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              name: string;
              description: string | null;
              steps: string[];
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

    if (want.has("people")) {
      promises.push(
        ctx.supabase
          .from("people")
          .select("id, name, relation, role, company, notes, last_interaction_at")
          .eq("user_id", ctx.userId)
          .or(
            `name.ilike.${pat},role.ilike.${pat},company.ilike.${pat},notes.ilike.${pat}`,
          )
          .order("last_interaction_at", { ascending: false, nullsFirst: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              name: string;
              relation: string;
              role: string | null;
              company: string | null;
              notes: string | null;
              last_interaction_at: string | null;
            }>).map((r) => ({
              kind: "people",
              id: r.id,
              snippet: `${r.name}${r.role ? ` · ${r.role}` : ""}${r.company ? ` @ ${r.company}` : ""}`,
              date: r.last_interaction_at,
              extra: { relation: r.relation, notes: r.notes },
            })),
          ),
      );
    }

    if (want.has("intentions")) {
      promises.push(
        ctx.supabase
          .from("intentions")
          .select("id, text, log_date, completed_at")
          .eq("user_id", ctx.userId)
          .ilike("text", pat)
          .order("log_date", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              log_date: string;
              completed_at: string | null;
            }>).map((r) => ({
              kind: "intentions",
              id: r.id,
              snippet: r.text,
              date: r.log_date,
              extra: { completed: r.completed_at != null },
            })),
          ),
      );
    }

    if (want.has("standups")) {
      promises.push(
        ctx.supabase
          .from("standups")
          .select("id, log_date, yesterday, today, blockers")
          .eq("user_id", ctx.userId)
          .or(
            `yesterday.ilike.${pat},today.ilike.${pat},blockers.ilike.${pat}`,
          )
          .order("log_date", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              log_date: string;
              yesterday: string | null;
              today: string | null;
              blockers: string | null;
            }>).map((r) => {
              const parts: string[] = [];
              if (r.yesterday && r.yesterday.toLowerCase().includes(input.q.toLowerCase())) {
                parts.push(`yesterday: ${r.yesterday}`);
              }
              if (r.today && r.today.toLowerCase().includes(input.q.toLowerCase())) {
                parts.push(`today: ${r.today}`);
              }
              if (r.blockers && r.blockers.toLowerCase().includes(input.q.toLowerCase())) {
                parts.push(`blockers: ${r.blockers}`);
              }
              return {
                kind: "standups",
                id: r.id,
                snippet: parts.join(" · ") || r.today || r.yesterday || r.blockers || "",
                date: r.log_date,
                extra: {},
              };
            }),
          ),
      );
    }

    if (want.has("reading_list")) {
      promises.push(
        ctx.supabase
          .from("reading_list")
          .select("id, title, url, note, summary, read_at, archived_at, saved_at")
          .eq("user_id", ctx.userId)
          .or(`title.ilike.${pat},note.ilike.${pat},summary.ilike.${pat},url.ilike.${pat}`)
          .order("saved_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              title: string | null;
              url: string;
              note: string | null;
              summary: string | null;
              read_at: string | null;
              archived_at: string | null;
              saved_at: string;
            }>).map((r) => ({
              kind: "reading_list",
              id: r.id,
              snippet: r.title || r.url,
              date: r.saved_at,
              extra: {
                url: r.url,
                note: r.note,
                summary: r.summary,
                status: r.archived_at ? "archived" : r.read_at ? "read" : "unread",
              },
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
      query: input.q,
      total: all.length,
      counts,
      hits: all,
    };
  },
});
