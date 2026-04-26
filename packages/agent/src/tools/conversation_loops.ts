// Brain tools for the CONVERSATION LOOP DETECTOR — recurring questions /
// topic threads mined from the user's OWN MESSAGES across conversations.
// Most users circle the same 3-5 questions for months without seeing it.
// The detector clusters user-role messages and surfaces 0-6 loops, each
// with a label, the recurring question in the user's voice, an
// oscillation-shape summary, dated quotes from prior messages, and an
// optional candidate exit ("Run a counter-self chamber against the
// position you keep returning to."). User can NAME (acknowledge),
// RESOLVE (write the answer), CONTEST, or DISMISS.

import { z } from "zod";
import { defineTool } from "./types";

type Quote = { date: string; snippet: string; conversation_id_prefix?: string };

type Loop = {
  id: string;
  scan_id: string | null;
  loop_label: string;
  recurring_question: string;
  pattern_summary: string;
  domain: string;
  occurrence_count: number;
  span_days: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  sample_quotes: Quote[];
  candidate_exit: string | null;
  strength: number;
  user_status: string | null;
  user_note: string | null;
  resolution_text: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

export const scanConversationLoopsTool = defineTool({
  name: "scan_conversation_loops",
  description: [
    "Run a CONVERSATION LOOP SCAN — mine the user's own messages",
    "across recent conversations to surface 0-6 questions they keep",
    "circling. Most people loop on 3-5 questions for months without",
    "seeing it ('should I focus on product or sales', 'is the agency",
    "worth keeping', 'am I a builder or operator'). The detector",
    "clusters by topic + question shape and returns each loop with a",
    "label, the recurring question in the user's voice, an oscillation",
    "summary, dated quotes (the receipts), and an optional",
    "candidate_exit (one sentence — what they could do to step out).",
    "",
    "Use when the user asks 'what am I circling on', 'what questions",
    "do I keep asking', 'what loops am I stuck in', 'what's the",
    "indecision I keep coming back to', 'mine my chats for patterns'.",
    "Costs an LLM round-trip (6-12s). Once a fortnight is plenty.",
    "",
    "Optional: window_days (14-180, default 60), min_occurrences",
    "(3-20, default 4) — the minimum distinct conversations a loop",
    "must appear in to be surfaced.",
    "",
    "Returns inserted loops. New loops land 'open' — the user must",
    "name / resolve / contest / dismiss via",
    "respond_to_conversation_loop.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(14).max(180).optional(),
    min_occurrences: z.number().int().min(3).max(20).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number" },
      min_occurrences: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/conversation-loops/scan`, {
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
      conversation_loops?: Loop[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      loops: (j.conversation_loops ?? []).map((p) => ({
        id: p.id,
        loop_label: p.loop_label,
        recurring_question: p.recurring_question,
        pattern_summary: p.pattern_summary,
        domain: p.domain,
        occurrence_count: p.occurrence_count,
        span_days: p.span_days,
        candidate_exit: p.candidate_exit,
        strength: p.strength,
      })),
    };
  },
});

export const listConversationLoopsTool = defineTool({
  name: "list_conversation_loops",
  description: [
    "List the user's surfaced conversation loops — recurring questions",
    "mined from their own messages, in any user_status. Optional:",
    "status (open | named | resolved | contested | dismissed |",
    "any_resolved | archived | pinned | all, default open),",
    "domain (energy | mood | focus | time | decisions | relationships",
    "| work | identity | money | mixed),",
    "limit (default 30, max 100).",
    "",
    "Worth calling before any decision conversation. RESOLVED loops",
    "carry the user's own answer in resolution_text — quote that back",
    "before they re-enter the loop. NAMED loops are ones they've",
    "acknowledged but not answered yet — flag them gently.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "named", "resolved", "contested", "dismissed", "any_resolved", "archived", "pinned", "all"]).optional().default("open"),
    domain: z.enum(["energy", "mood", "focus", "time", "decisions", "relationships", "work", "identity", "money", "mixed"]).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "named", "resolved", "contested", "dismissed", "any_resolved", "archived", "pinned", "all"] },
      domain: { type: "string", enum: ["energy", "mood", "focus", "time", "decisions", "relationships", "work", "identity", "money", "mixed"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = Math.max(1, Math.min(100, input.limit ?? 30));

    let q = ctx.supabase
      .from("conversation_loops")
      .select("id, scan_id, loop_label, recurring_question, pattern_summary, domain, occurrence_count, span_days, first_seen_at, last_seen_at, sample_quotes, candidate_exit, strength, user_status, user_note, resolution_text, resolved_at, pinned, archived_at, created_at")
      .eq("user_id", ctx.userId);

    if (input.domain) q = q.eq("domain", input.domain);

    if (status === "open") q = q.is("user_status", null).is("archived_at", null);
    else if (status === "named") q = q.eq("user_status", "named");
    else if (status === "resolved") q = q.eq("user_status", "resolved");
    else if (status === "contested") q = q.eq("user_status", "contested");
    else if (status === "dismissed") q = q.eq("user_status", "dismissed");
    else if (status === "any_resolved") q = q.not("user_status", "is", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

    q = q.order("strength", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as Loop[];

    return {
      ok: true,
      count: rows.length,
      loops: rows.map((p) => ({
        id: p.id,
        loop_label: p.loop_label,
        recurring_question: p.recurring_question,
        pattern_summary: p.pattern_summary,
        domain: p.domain,
        occurrence_count: p.occurrence_count,
        span_days: p.span_days,
        candidate_exit: p.candidate_exit,
        strength: p.strength,
        user_status: p.user_status,
        user_note: p.user_note,
        resolution_text: p.resolution_text,
        pinned: p.pinned,
        archived: p.archived_at != null,
        resolved_at: p.resolved_at,
        created_at: p.created_at,
      })),
    };
  },
});

export const respondToConversationLoopTool = defineTool({
  name: "respond_to_conversation_loop",
  description: [
    "Respond to a conversation loop. Specify exactly one mode:",
    "",
    "  name      — acknowledge the loop. user_note recommended.",
    "  resolve   — close the loop with the user's actual answer in",
    "              their own voice. resolution_text REQUIRED (>=8 chars).",
    "  contest   — the cluster is wrong. user_note required.",
    "  dismiss   — uninteresting / already known. Optional user_note.",
    "  pin / unpin       — keep visible at the top.",
    "  archive / restore — hide / unhide.",
    "",
    "Use ONLY when the user has explicitly responded to a specific",
    "loop. Don't guess on their behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["name", "resolve", "contest", "dismiss", "pin", "unpin", "archive", "restore"]),
    user_note: z.string().min(1).max(800).optional(),
    resolution_text: z.string().min(8).max(4000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["name", "resolve", "contest", "dismiss", "pin", "unpin", "archive", "restore"] },
      user_note: { type: "string" },
      resolution_text: { type: "string" },
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
    if (input.mode === "name") {
      payload.status = "named";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "resolve") {
      if (!input.resolution_text || input.resolution_text.trim().length < 8) {
        return { ok: false, error: "resolution_text required (min 8 chars) for mode=resolve" };
      }
      payload.status = "resolved";
      payload.resolution_text = input.resolution_text;
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "contest") {
      if (!input.user_note) return { ok: false, error: "user_note required for mode=contest" };
      payload.status = "contested";
      payload.user_note = input.user_note;
    } else if (input.mode === "dismiss") {
      payload.status = "dismissed";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "pin") {
      payload.pin = true;
    } else if (input.mode === "unpin") {
      payload.pin = false;
    } else if (input.mode === "archive") {
      payload.archive = true;
    } else if (input.mode === "restore") {
      payload.restore = true;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/conversation-loops/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { conversation_loop?: Loop };
    if (!j.conversation_loop) return { ok: false, error: "no row returned" };
    const p = j.conversation_loop;
    return {
      ok: true,
      loop: {
        id: p.id,
        domain: p.domain,
        loop_label: p.loop_label,
        recurring_question: p.recurring_question,
        user_status: p.user_status,
        user_note: p.user_note,
        resolution_text: p.resolution_text,
        pinned: p.pinned,
        archived: p.archived_at != null,
      },
    };
  },
});
