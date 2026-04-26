// Brain tools for talking to future-you. Use when the user asks for
// the future-self's opinion before a major decision, when they're
// stuck on whether a path is worth it, or when they want a moment of
// perspective from the version of themselves they're heading toward.
//
// IMPORTANT: This is not a coach or oracle pretending to be from the
// future. The persona is conditioned on the user's OWN data — their
// active identity claims, their open goals, their active themes, and
// (for 6m/12m) their latest trajectory projection. Future-you speaks
// in first person, grounded in evidence the user has actually written.

import { z } from "zod";
import { defineTool } from "./types";

type CreateResponse = {
  dialogue?: { id: string; horizon: string; title: string | null };
  messages?: Array<{ id: string; role: string; content: string; created_at: string }>;
};

type DialogueListItem = {
  id: string;
  horizon: string;
  title: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export const askFutureSelfTool = defineTool({
  name: "ask_future_self",
  description: [
    "Ask future-you a single question and get their reply. Creates a",
    "fresh dialogue grounded in the user's current identity claims +",
    "active goals + active themes + latest trajectory projection.",
    "Returns the future-self's reply (2-4 short paragraphs, first",
    "person, in character). The dialogue is persisted so the user can",
    "continue it on the /future-self page.",
    "",
    "Required: question. Optional: horizon ('6_months' | '12_months' |",
    "'5_years', default 12_months). Use 5_years for more imaginative",
    "asks (no trajectory body anchor at that range).",
    "",
    "Use when the user says 'ask future me', 'what would future-me",
    "say', 'I want my future-self's view', 'should I take this path',",
    "or before any major decision so they can sanity-check against",
    "the version of themselves they're projecting into.",
  ].join("\n"),
  schema: z.object({
    question: z.string().min(1).max(2000),
    horizon: z.enum(["6_months", "12_months", "5_years"]).optional().default("12_months"),
  }),
  inputSchema: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string" },
      horizon: { type: "string", enum: ["6_months", "12_months", "5_years"] },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (ctx.supabase as unknown as { rest: { headers: Record<string, string> } }).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /future-self" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/future-self`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ horizon: input.horizon ?? "12_months", opening_question: input.question }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `dialogue failed (${r.status}): ${err.slice(0, 200)}` };
    }
    const j = (await r.json()) as CreateResponse;
    const reply = (j.messages ?? []).find((m) => m.role === "future_self");
    if (!j.dialogue || !reply) return { ok: false, error: "no reply produced" };
    return {
      ok: true,
      dialogue_id: j.dialogue.id,
      horizon: j.dialogue.horizon,
      reply: reply.content,
    };
  },
});

export const listFutureSelfDialoguesTool = defineTool({
  name: "list_future_self_dialogues",
  description: [
    "List the user's stored future-self dialogues (newest first).",
    "Optional: status (active | pinned | archived | all, default",
    "active); limit (default 10). Returns id, horizon, title, pinned",
    "flag, and last-update timestamp for each.",
    "",
    "Use when the user references a past conversation with their",
    "future-self ('go back to that dialogue we had', 'what did 12-month",
    "me say last time') or when surveying recent reflective work.",
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
      .from("future_self_dialogues")
      .select("id, horizon, title, pinned, archived_at, created_at, updated_at")
      .eq("user_id", ctx.userId);
    if (status === "active") q = q.is("archived_at", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
    q = q.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as DialogueListItem[];
    return {
      ok: true,
      count: rows.length,
      dialogues: rows.map((r) => ({
        id: r.id,
        horizon: r.horizon,
        title: r.title,
        pinned: r.pinned,
        updated_at: r.updated_at,
        created_at: r.created_at,
      })),
    };
  },
});
