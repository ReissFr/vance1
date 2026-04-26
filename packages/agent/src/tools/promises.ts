// Brain tools for the PROMISE LEDGER — self-promises mined from the user's
// own messages. The most uncomfortable mirror in JARVIS: every "I will X",
// "starting Monday I'll Y", "next week I'm going to Z" the user has said
// to themselves, with deadline tracking and kept/broken status. Surfaces
// the user's relationship with their own word.

import { z } from "zod";
import { defineTool } from "./types";

type Promise = {
  id: string;
  scan_id: string | null;
  action_summary: string;
  original_quote: string;
  category: string;
  deadline_text: string | null;
  deadline_date: string | null;
  promised_at: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  strength: number;
  repeat_count: number;
  prior_promise_id: string | null;
  status: string;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  pending: number;
  overdue: number;
  kept: number;
  broken: number;
  deferred: number;
  cancelled: number;
  unclear: number;
  resolved: number;
  repromised: number;
  self_trust_rate: number | null;
};

export const scanPromisesTool = defineTool({
  name: "scan_promises",
  description: [
    "Run a PROMISE LEDGER SCAN — mine the user's own messages for every",
    "SELF-PROMISE they've made: 'I will X', 'starting Monday I'll Y',",
    "'next week I'm going to Z', 'I need to W', 'no more X', 'from now",
    "on I X'. Each detected promise is logged with the verbatim quote,",
    "the action distillation, the deadline (if specified), the date it",
    "was made, and the commitment strength. Re-promises (similar action,",
    "earlier in the window) are flagged with repeat_count.",
    "",
    "Use when the user asks 'what have I promised myself', 'am I a",
    "person who keeps their word', 'mine my chats for promises',",
    "'show me my self-promises', 'what have I committed to that I",
    "haven't done', or after a self-trust conversation.",
    "",
    "Optional: window_days (14-365, default 120). Costs an LLM",
    "round-trip (8-15s). Once a fortnight is plenty.",
    "",
    "Returns the inserted promises + signal counts. The brain should",
    "follow up by reading list_promises (esp. status=overdue) before",
    "discussing the user's relationship with their own word.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(14).max(365).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/promises/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input ?? {}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      promises?: Promise[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      promises: (j.promises ?? []).map((p) => ({
        id: p.id,
        action_summary: p.action_summary,
        category: p.category,
        deadline_text: p.deadline_text,
        deadline_date: p.deadline_date,
        promised_at: p.promised_at,
        strength: p.strength,
        repeat_count: p.repeat_count,
      })),
    };
  },
});

export const listPromisesTool = defineTool({
  name: "list_promises",
  description: [
    "List promises in the user's ledger plus self-trust stats.",
    "Optional: status (pending | overdue | due | kept | broken |",
    "deferred | cancelled | unclear | resolved | pinned | archived |",
    "all, default pending), category (habit | decision | relationship",
    "| health | work | creative | financial | identity | other),",
    "limit (default 30, max 100).",
    "",
    "Returns rows + a STATS object: { total, pending, overdue, kept,",
    "broken, deferred, cancelled, unclear, resolved, repromised,",
    "self_trust_rate } where self_trust_rate is the % of decided",
    "(kept+broken) promises that were KEPT. The brain should reference",
    "this BEFORE responding to a fresh promise: 'you've kept 4 of 7",
    "decided promises this year — your self-trust rate is 57%, and",
    "you've re-promised this exact thing 3 times. Want to put a",
    "specific deadline on it this time?'",
    "",
    "OVERDUE promises (pending + deadline_date < today) are the most",
    "load-bearing — surface them gently when the user circles back to",
    "the same topic.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "overdue", "due", "kept", "broken", "deferred", "cancelled", "unclear", "resolved", "pinned", "archived", "all"]).optional().default("pending"),
    category: z.enum(["habit", "decision", "relationship", "health", "work", "creative", "financial", "identity", "other"]).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "overdue", "due", "kept", "broken", "deferred", "cancelled", "unclear", "resolved", "pinned", "archived", "all"] },
      category: { type: "string", enum: ["habit", "decision", "relationship", "health", "work", "creative", "financial", "identity", "other"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const params = new URLSearchParams();
    params.set("status", input.status ?? "pending");
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));
    if (input.category) params.set("category", input.category);

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/promises?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { promises?: Promise[]; stats?: Stats };
    const rows = j.promises ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      promises: rows.map((p) => ({
        id: p.id,
        action_summary: p.action_summary,
        original_quote: p.original_quote,
        category: p.category,
        deadline_text: p.deadline_text,
        deadline_date: p.deadline_date,
        promised_at: p.promised_at,
        strength: p.strength,
        repeat_count: p.repeat_count,
        status: p.status,
        status_note: p.status_note,
        pinned: p.pinned,
        archived: p.archived_at != null,
        resolved_at: p.resolved_at,
      })),
    };
  },
});

export const respondToPromiseTool = defineTool({
  name: "respond_to_promise",
  description: [
    "Resolve or annotate a promise. Specify exactly one mode:",
    "",
    "  kept       — the user kept the promise. status_note recommended",
    "               (what actually happened).",
    "  broken     — the user did not keep it. status_note recommended.",
    "  deferred   — pushed to a later date — use this when the user",
    "               wants to keep the promise alive but missed the",
    "               original deadline.",
    "  cancelled  — the user has decided the promise no longer applies.",
    "  unclear    — can't be honestly decided. status_note recommended.",
    "  reschedule — adjust deadline_date (requires deadline_date as",
    "               YYYY-MM-DD or null for open).",
    "  pin / unpin       — keep visible at the top.",
    "  archive / restore — hide / unhide.",
    "",
    "Use ONLY when the user has explicitly responded to a specific",
    "promise. Don't guess kept/broken on the user's behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["kept", "broken", "deferred", "cancelled", "unclear", "reschedule", "pin", "unpin", "archive", "restore"]),
    status_note: z.string().min(1).max(800).optional(),
    deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["kept", "broken", "deferred", "cancelled", "unclear", "reschedule", "pin", "unpin", "archive", "restore"] },
      status_note: { type: "string" },
      deadline_date: { type: ["string", "null"] },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const payload: Record<string, unknown> = {};
    if (input.mode === "kept" || input.mode === "broken" || input.mode === "deferred" || input.mode === "cancelled" || input.mode === "unclear") {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "reschedule") {
      if (input.deadline_date === undefined) return { ok: false, error: "deadline_date required for mode=reschedule (YYYY-MM-DD or null)" };
      payload.deadline_date = input.deadline_date;
    } else if (input.mode === "pin") {
      payload.pin = true;
    } else if (input.mode === "unpin") {
      payload.pin = false;
    } else if (input.mode === "archive") {
      payload.archive = true;
    } else if (input.mode === "restore") {
      payload.restore = true;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/promises/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { promise?: Promise };
    if (!j.promise) return { ok: false, error: "no row returned" };
    const p = j.promise;
    return {
      ok: true,
      promise: {
        id: p.id,
        action_summary: p.action_summary,
        category: p.category,
        deadline_date: p.deadline_date,
        status: p.status,
        status_note: p.status_note,
        pinned: p.pinned,
        archived: p.archived_at != null,
      },
    };
  },
});
