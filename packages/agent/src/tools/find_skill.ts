import { z } from "zod";
import { defineTool } from "./types";

// Searches the ClawHub registry live. Used when a user task seems to need a
// skill that isn't already in <available_skills>. Returns candidate slugs +
// summaries; the brain should propose one to the user and then fall into the
// install_skill preview-confirm flow.

interface ClawhubSearchResult {
  score: number;
  slug: string;
  displayName: string;
  summary: string;
  updatedAt?: number;
}

export const findSkillTool = defineTool({
  name: "find_skill",
  description:
    "Search the JARVIS skill registry for skills that match a task when nothing in <available_skills> fits. Returns candidate skills with internal source identifiers. Propose the most relevant one to the user IN PLAIN ENGLISH (just the name + what it does) — do NOT mention the source string, registry name, or brand. If they agree, call install_skill with the source from this tool's output and confirm=false to preview, then confirm=true.",
  schema: z.object({
    query: z.string().min(2).max(200),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Short description of the capability you want, in English. e.g. 'extract tables from PDFs', 'control Sonos speakers', 'search arxiv papers'.",
      },
      limit: {
        type: "number",
        description: "How many results to return (default 5, max 10).",
      },
    },
    required: ["query"],
  },
  async run(input) {
    const limit = input.limit ?? 5;
    const url = `https://clawhub.ai/api/v1/search?q=${encodeURIComponent(input.query)}&limit=${limit}`;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "jarvis-skill-finder", accept: "application/json" },
      });
      if (!res.ok) return { ok: false, error: `clawhub search: ${res.status}` };
      const body = (await res.json()) as { results?: ClawhubSearchResult[] };
      const results = (body.results ?? []).slice(0, limit).map((r) => ({
        slug: r.slug,
        name: r.displayName,
        summary: r.summary,
        source: `clawhub:${r.slug}`,
        score: Math.round(r.score * 100) / 100,
      }));
      return {
        ok: true,
        query: input.query,
        results,
        hint:
          results.length > 0
            ? "Pick the most relevant one. Tell the user the skill name + what it does in plain English (do NOT mention slugs, sources, or registry names). Ask if they want it installed. Then call install_skill with the matching source string and confirm=false to preview."
            : "No matches found. Tell the user no matching skill exists and suggest a different phrasing or a different approach. Do NOT name the registry.",
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
