// Brain tools for Time Letters — letters across time. Three flavours:
//
//   * forward   — write today, sealed, delivered on a future date via
//                 WhatsApp. The body stays hidden from the user until
//                 then. Use when the user says "send me a letter in 6
//                 months", "remind me on March 20 to remember this".
//
//   * backward  — JARVIS GENERATES a letter voiced AS the user's
//                 past-self, drawn from their actual entries within
//                 the window before written_at_date. Use when the user
//                 asks "write me a letter from past-me 6 months ago",
//                 "what would I have said to me-now from January".
//
//   * posterity — written today, addressed to a past version of the
//                 user. Just stored, no delivery. Use when the user
//                 says "I want to write what I wish I'd known back
//                 then", "letter to me-from-2023".

import { z } from "zod";
import { defineTool } from "./types";

type Letter = {
  id: string;
  kind: "forward" | "backward" | "posterity";
  title: string;
  body: string;
  written_at_date: string;
  target_date: string | null;
  delivered_at: string | null;
  delivered_via: string | null;
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  latency_ms: number | null;
  model: string | null;
  user_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export const sealTimeLetterTool = defineTool({
  name: "seal_time_letter",
  description: [
    "Seal or generate a TIME LETTER — a message across time. Three",
    "kinds (specify exactly one):",
    "",
    "  forward   — write today, sealed, delivered to the user on",
    "              target_date via WhatsApp. Required: title, body,",
    "              target_date (YYYY-MM-DD, must be in the future).",
    "",
    "  backward  — JARVIS GENERATES a letter voiced as the user's",
    "              past-self at written_at_date, drawn from their",
    "              actual entries from the preceding window. Costs an",
    "              LLM round-trip (3-8s). Required: written_at_date",
    "              (YYYY-MM-DD, must be in the past). Optional:",
    "              window_days (14-365, default 60).",
    "",
    "  posterity — written today, addressed TO a past version of the",
    "              user. No delivery, just stored. Required: title,",
    "              body, written_at_date (must be in the past).",
    "",
    "Use when the user says 'write me a letter from past-me', 'send a",
    "letter to future-me on date X', 'I want to write to past-me-from-",
    "January'. For forward letters, capture the user's exact words —",
    "don't paraphrase. For backward letters, never invent a body — only",
    "the route can synthesise from real entries.",
  ].join("\n"),
  schema: z.object({
    kind: z.enum(["forward", "backward", "posterity"]),
    title: z.string().min(1).max(80).optional(),
    body: z.string().min(8).max(4000).optional(),
    target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    written_at_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    window_days: z.number().int().min(14).max(365).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: ["forward", "backward", "posterity"] },
      title: { type: "string" },
      body: { type: "string" },
      target_date: { type: "string" },
      written_at_date: { type: "string" },
      window_days: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/time-letters`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `seal failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { letter?: Letter };
    if (!j.letter) return { ok: false, error: "no letter produced" };
    const l = j.letter;
    return {
      ok: true,
      letter: {
        id: l.id,
        kind: l.kind,
        title: l.title,
        body: l.kind === "backward" || l.kind === "posterity" ? l.body : undefined,
        body_length: l.body.length,
        written_at_date: l.written_at_date,
        target_date: l.target_date,
        source_summary: l.source_summary,
      },
    };
  },
});

export const listTimeLettersTool = defineTool({
  name: "list_time_letters",
  description: [
    "List the user's time letters. Optional: status (all | pending |",
    "delivered | archived | pinned, default all); kind (forward |",
    "backward | posterity, default all); limit (default 30, max 80).",
    "",
    "Use when the user asks 'what letters have I sealed', 'show my",
    "pending time letters', 'when does my next letter unlock', 'have",
    "I written any letters from past-me yet'. CAUTION: returning the",
    "body of a PENDING FORWARD letter would break the seal — only",
    "return body for delivered/backward/posterity rows.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["all", "pending", "delivered", "archived", "pinned"]).optional().default("all"),
    kind: z.enum(["forward", "backward", "posterity"]).optional(),
    limit: z.number().int().min(1).max(80).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["all", "pending", "delivered", "archived", "pinned"] },
      kind: { type: "string", enum: ["forward", "backward", "posterity"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "all";
    const limit = Math.max(1, Math.min(80, input.limit ?? 30));

    let q = ctx.supabase
      .from("time_letters")
      .select("id, kind, title, body, written_at_date, target_date, delivered_at, delivered_via, source_summary, source_counts, latency_ms, model, user_note, pinned, archived_at, cancelled_at, created_at")
      .eq("user_id", ctx.userId);

    if (input.kind) q = q.eq("kind", input.kind);

    if (status === "pending") q = q.eq("kind", "forward").is("delivered_at", null).is("cancelled_at", null).is("archived_at", null);
    else if (status === "delivered") q = q.eq("kind", "forward").not("delivered_at", "is", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

    q = q.order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as Letter[];

    return {
      ok: true,
      count: rows.length,
      letters: rows.map((l) => {
        const isPendingForward = l.kind === "forward" && l.delivered_at == null && l.cancelled_at == null;
        return {
          id: l.id,
          kind: l.kind,
          title: l.title,
          // hide body for pending forwards — the seal must hold
          body: isPendingForward ? null : l.body,
          written_at_date: l.written_at_date,
          target_date: l.target_date,
          delivered_at: l.delivered_at,
          cancelled: l.cancelled_at != null,
          archived: l.archived_at != null,
          pinned: l.pinned,
          user_note: l.user_note,
          source_summary: l.source_summary,
        };
      }),
    };
  },
});
