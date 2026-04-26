// Brain tools for Life Timeline — JARVIS stitches the user's
// reflections / decisions / wins / standups into 3-7 narrative
// CHAPTERS, each with a 3-6 word title and a 3-4 sentence paragraph
// that characterises the era. Re-stitching produces a fresh row whose
// drift_summary contrasts it with the previous one (chapters can
// merge / split / re-titlt as more writing accumulates).
//
// Use these when the user says things like "stitch my life so far",
// "what era am I in", "show me my life as chapters", "how has my
// story unfolded", or as a quarterly close ("stitch the timeline,
// what's drifted").

import { z } from "zod";
import { defineTool } from "./types";

type Chapter = {
  ordinal: number;
  title: string;
  narrative: string;
  start_date: string;
  end_date: string | null;
  themes: string[];
  key_decision_ids: string[];
  key_win_ids: string[];
};

type Timeline = {
  id: string;
  chapters: Chapter[];
  drift_summary: string | null;
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  earliest_date: string | null;
  latest_date: string | null;
  parent_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

export const stitchLifeTimelineTool = defineTool({
  name: "stitch_life_timeline",
  description: [
    "Stitch the user's life-so-far into 3-7 narrative CHAPTERS.",
    "Pulls reflections, decisions, wins, standups, and themes within",
    "the window, then asks the model to GROUP the stream into eras",
    "where themes hold steady then pivot. Each chapter gets a 3-6 word",
    "title and a 3-4 sentence paragraph that characterises the era.",
    "Optional: window_days (90-3650, default 1095 = ~3 years).",
    "",
    "Use when the user asks 'stitch my life so far', 'show my life as",
    "chapters', 'what era am I in', 'how has my story unfolded', or as",
    "a quarterly close. Don't re-stitch obsessively — once a week or",
    "after a major decision is plenty; the drift is small in between.",
    "",
    "Returns the timeline id, chapter previews (title + date range),",
    "and the drift_summary (one sentence on what re-configured vs the",
    "previous timeline) so you can read it back to the user.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(90).max(3650).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: { window_days: { type: "number" } },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/life-timelines`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input.window_days ? { window_days: input.window_days } : {}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `stitch failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { timeline?: Timeline };
    if (!j.timeline) return { ok: false, error: "no timeline produced" };
    const t = j.timeline;
    return {
      ok: true,
      timeline: {
        id: t.id,
        stitched_at: t.created_at,
        chapter_count: t.chapters.length,
        earliest_date: t.earliest_date,
        latest_date: t.latest_date,
        drift_summary: t.drift_summary,
        chapters: t.chapters.map((c) => ({
          ordinal: c.ordinal,
          title: c.title,
          start_date: c.start_date,
          end_date: c.end_date,
          themes: c.themes,
          decision_count: c.key_decision_ids.length,
          win_count: c.key_win_ids.length,
        })),
        source_summary: t.source_summary,
      },
    };
  },
});

export const listLifeTimelinesTool = defineTool({
  name: "list_life_timelines",
  description: [
    "List the user's recent life-timelines. Optional: status (active |",
    "pinned | archived | all, default active); limit (default 5,",
    "max 40). Returns chapter previews for each — title, date range,",
    "themes — and the drift_summary so you can read the story back.",
    "",
    "Use when the user asks 'what's my life timeline say', 'show the",
    "chapters', 'what era am I in', 'how has the story changed since",
    "last time'. The most recent active row is the current view.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "pinned", "archived", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(40).optional().default(5),
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
    const limit = Math.max(1, Math.min(40, input.limit ?? 5));

    let q = ctx.supabase
      .from("life_timelines")
      .select("id, chapters, drift_summary, source_summary, earliest_date, latest_date, parent_id, pinned, archived_at, user_note, created_at")
      .eq("user_id", ctx.userId);

    if (status === "active") q = q.is("archived_at", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

    q = q.order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as Timeline[];

    return {
      ok: true,
      count: rows.length,
      timelines: rows.map((t) => ({
        id: t.id,
        stitched_at: t.created_at,
        chapter_count: t.chapters.length,
        earliest_date: t.earliest_date,
        latest_date: t.latest_date,
        drift_summary: t.drift_summary,
        pinned: t.pinned,
        archived: t.archived_at != null,
        chapters: t.chapters.map((c) => ({
          ordinal: c.ordinal,
          title: c.title,
          start_date: c.start_date,
          end_date: c.end_date,
          themes: c.themes,
          narrative: c.narrative,
        })),
        source_summary: t.source_summary,
        user_note: t.user_note,
      })),
    };
  },
});
