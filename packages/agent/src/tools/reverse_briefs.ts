// Brain tools for Reverse Briefs — archaeology of belief from action.
//
// Premise: every productivity tool tells the user what they SHOULD do.
// None tell them what their actions reveal they ACTUALLY believe. A
// reverse brief reads a single day's behaviour (intentions / standup /
// daily check-in / decisions / reflections / wins / commitments
// handled) and infers what the user MUST have implicitly believed for
// those choices to be coherent. Surfaces 3-6 implicit beliefs in
// second-person voice with confidence ratings, plus a 2-3 sentence
// summary, plus optional CONFLICTS where implicit beliefs contradict
// the user's stated identity claims or active themes.
//
// Use sparingly. The brief is most powerful as an evening-close ritual
// or as the opening of a hard reflection conversation. Don't generate
// daily — that turns archaeology into noise.

import { z } from "zod";
import { defineTool } from "./types";

type ImplicitBelief = { belief: string; evidence: string | null; confidence: number };
type Conflict = { implicit: string; stated: string; tension_note: string };
type ReverseBrief = {
  id: string;
  brief_date: string;
  implicit_beliefs: ImplicitBelief[];
  summary: string;
  conflicts: Conflict[];
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  latency_ms: number | null;
  model: string | null;
  user_status: "acknowledged" | "contested" | "dismissed" | null;
  user_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
};

export const generateReverseBriefTool = defineTool({
  name: "generate_reverse_brief",
  description: [
    "Generate a REVERSE BRIEF for a single day — read the day's actual",
    "behaviour (intentions / standup / check-in / decisions /",
    "reflections / wins / commitments handled) and infer what the user",
    "must have IMPLICITLY believed for those choices to be coherent.",
    "Costs an LLM round-trip (4-8s). Upserts on (user, date) so",
    "re-running the same date overwrites instead of duplicating.",
    "",
    "Use when the user asks 'what does today say I believe', 'what was",
    "I really operating from', 'where did my actions and my values",
    "diverge', 'reverse-engineer my day', 'what was driving me today'.",
    "Strong as an evening-close ritual or the opening of a hard",
    "reflection conversation. Don't fire on every day — generally",
    "once a week is plenty.",
    "",
    "Optional: brief_date YYYY-MM-DD (default = today). Must be today",
    "or in the past. Returns implicit_beliefs (with confidence 1-5",
    "each) + summary + conflicts (gaps between implicit and stated",
    "identity).",
  ].join("\n"),
  schema: z.object({
    brief_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      brief_date: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/reverse-briefs`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input ?? {}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `reverse-brief failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { reverse_brief?: ReverseBrief };
    if (!j.reverse_brief) return { ok: false, error: "no brief produced" };
    const b = j.reverse_brief;
    return {
      ok: true,
      reverse_brief: {
        id: b.id,
        brief_date: b.brief_date,
        summary: b.summary,
        implicit_beliefs: b.implicit_beliefs,
        conflicts: b.conflicts,
        source_summary: b.source_summary,
        latency_ms: b.latency_ms,
      },
    };
  },
});

export const listReverseBriefsTool = defineTool({
  name: "list_reverse_briefs",
  description: [
    "List the user's reverse briefs. Optional: status (open |",
    "acknowledged | contested | dismissed | resolved | archived |",
    "pinned | all, default open), limit (default 30, max 100).",
    "",
    "Worth calling before any heavy reflection conversation so you",
    "know what gaps the user has acknowledged between their stated",
    "identity and their actual behaviour. Returns full implicit",
    "beliefs and conflicts.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "acknowledged", "contested", "dismissed", "resolved", "archived", "pinned", "all"]).optional().default("open"),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "acknowledged", "contested", "dismissed", "resolved", "archived", "pinned", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = Math.max(1, Math.min(100, input.limit ?? 30));

    let q = ctx.supabase
      .from("reverse_briefs")
      .select("id, brief_date, implicit_beliefs, summary, conflicts, source_summary, source_counts, user_status, user_note, resolved_at, pinned, archived_at, created_at")
      .eq("user_id", ctx.userId);

    if (status === "open") q = q.is("user_status", null).is("archived_at", null);
    else if (status === "acknowledged") q = q.eq("user_status", "acknowledged");
    else if (status === "contested") q = q.eq("user_status", "contested");
    else if (status === "dismissed") q = q.eq("user_status", "dismissed");
    else if (status === "resolved") q = q.not("user_status", "is", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

    q = q.order("brief_date", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as ReverseBrief[];

    return {
      ok: true,
      count: rows.length,
      reverse_briefs: rows.map((b) => ({
        id: b.id,
        brief_date: b.brief_date,
        summary: b.summary,
        implicit_beliefs: b.implicit_beliefs,
        conflicts: b.conflicts,
        user_status: b.user_status,
        user_note: b.user_note,
        pinned: b.pinned,
        archived: b.archived_at != null,
      })),
    };
  },
});

export const respondToReverseBriefTool = defineTool({
  name: "respond_to_reverse_brief",
  description: [
    "Resolve a reverse brief. Modes: acknowledge (yes that IS what I",
    "was operating from), contest (no, here's what was really driving",
    "me — user_note recommended), dismiss (signal is misleading),",
    "pin / unpin, archive / restore.",
    "",
    "Use ONLY when the user has explicitly responded to a specific",
    "brief. Don't guess — when in doubt, ask the user first.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["acknowledge", "contest", "dismiss", "pin", "unpin", "archive", "restore"]),
    user_note: z.string().min(1).max(800).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["acknowledge", "contest", "dismiss", "pin", "unpin", "archive", "restore"] },
      user_note: { type: "string" },
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
    if (input.mode === "acknowledge") {
      payload.status = "acknowledged";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "contest") {
      payload.status = "contested";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "dismiss") {
      payload.status = "dismissed";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/reverse-briefs/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { reverse_brief?: ReverseBrief };
    if (!j.reverse_brief) return { ok: false, error: "no row returned" };
    return {
      ok: true,
      reverse_brief: {
        id: j.reverse_brief.id,
        brief_date: j.reverse_brief.brief_date,
        user_status: j.reverse_brief.user_status,
        user_note: j.reverse_brief.user_note,
        pinned: j.reverse_brief.pinned,
        archived: j.reverse_brief.archived_at != null,
      },
    };
  },
});
