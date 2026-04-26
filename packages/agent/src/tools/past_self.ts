// Brain tools for talking to past-you. Use when the user wants the
// perspective of an earlier version of themselves — the one from
// 3 / 6 / 12 / 24 / 36 months ago, or any specific date in the past.
//
// IMPORTANT: This is not a guess. The persona is conditioned on the
// 60-day window of the user's OWN data leading up to that anchor date
// — their reflections, decisions, wins, intentions, check-ins, and
// standups from that period. Past-you speaks in first person, knows
// only what they knew then, and explicitly does not know how things
// turned out.

import { z } from "zod";
import { defineTool } from "./types";

type CreateResponse = {
  dialogue?: {
    id: string;
    anchor_date: string;
    horizon_label: string;
    title: string | null;
  };
  messages?: Array<{ id: string; role: string; content: string; created_at: string }>;
};

type DialogueListItem = {
  id: string;
  anchor_date: string;
  horizon_label: string;
  title: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export const askPastSelfTool = defineTool({
  name: "ask_past_self",
  description: [
    "Ask past-you a single question and get their reply. Creates a",
    "fresh dialogue grounded in the 60 days of evidence (reflections,",
    "decisions, wins, intentions, check-ins, standups) leading up to",
    "the anchor date. Returns past-you's reply (2-4 short paragraphs,",
    "first person, in character — they don't know what happens after",
    "the anchor). The dialogue is persisted so the user can continue",
    "it on the /past-self page.",
    "",
    "Required: question. Optional: horizon_label ('3_months_ago' |",
    "'6_months_ago' | '1_year_ago' | '2_years_ago' | '3_years_ago' |",
    "'custom', default 1_year_ago); anchor_date (YYYY-MM-DD, required",
    "when horizon_label is 'custom', otherwise derived from the",
    "horizon).",
    "",
    "Use when the user says 'ask past me', 'what would I-from-a-year-",
    "ago say', 'go back to me from 6 months ago', 'remind me how I",
    "was thinking back then', or before any decision where it would",
    "help to remember the perspective the user had at an earlier",
    "moment. Will fail with a clear error if there's not enough",
    "writing in the window around that anchor.",
  ].join("\n"),
  schema: z.object({
    question: z.string().min(1).max(2000),
    horizon_label: z
      .enum(["3_months_ago", "6_months_ago", "1_year_ago", "2_years_ago", "3_years_ago", "custom"])
      .optional()
      .default("1_year_ago"),
    anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string" },
      horizon_label: {
        type: "string",
        enum: [
          "3_months_ago",
          "6_months_ago",
          "1_year_ago",
          "2_years_ago",
          "3_years_ago",
          "custom",
        ],
      },
      anchor_date: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /past-self" };
    }

    const horizonLabel = input.horizon_label ?? "1_year_ago";
    const payload: Record<string, unknown> = {
      horizon_label: horizonLabel,
      opening_question: input.question,
    };
    if (input.anchor_date) payload.anchor_date = input.anchor_date;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/past-self`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `dialogue failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as CreateResponse;
    const reply = (j.messages ?? []).find((m) => m.role === "past_self");
    if (!j.dialogue || !reply) return { ok: false, error: "no reply produced" };
    return {
      ok: true,
      dialogue_id: j.dialogue.id,
      anchor_date: j.dialogue.anchor_date,
      horizon_label: j.dialogue.horizon_label,
      reply: reply.content,
    };
  },
});

export const listPastSelfDialoguesTool = defineTool({
  name: "list_past_self_dialogues",
  description: [
    "List the user's stored past-self dialogues (newest first).",
    "Optional: status (active | pinned | archived | all, default",
    "active); limit (default 10). Returns id, anchor_date, horizon",
    "label, title, pinned flag, and last-update timestamp for each.",
    "",
    "Use when the user references an earlier dialogue with their",
    "past-self ('what did 6-month-me say last time', 'open that",
    "conversation I had with past-me') or when surveying recent",
    "reflective work.",
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
      .from("past_self_dialogues")
      .select("id, anchor_date, horizon_label, title, pinned, archived_at, created_at, updated_at")
      .eq("user_id", ctx.userId);
    if (status === "active") q = q.is("archived_at", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
    q = q
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as DialogueListItem[];
    return {
      ok: true,
      count: rows.length,
      dialogues: rows.map((r) => ({
        id: r.id,
        anchor_date: r.anchor_date,
        horizon_label: r.horizon_label,
        title: r.title,
        pinned: r.pinned,
        updated_at: r.updated_at,
        created_at: r.created_at,
      })),
    };
  },
});
