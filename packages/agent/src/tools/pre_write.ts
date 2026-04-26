// Brain tools for Pre-Write — JARVIS drafts the user's next reflection /
// standup / intention / win / checkin BEFORE they open the form, in their
// own voice, so they edit instead of starting from blank. Each draft is
// logged with the user's eventual response (accepted as-is / edited /
// rejected / superseded) so JARVIS learns which kinds it predicts well.
//
// Use these when the user says "draft my standup", "write my reflection
// for me", "what would I write today", "I don't know where to start with
// my journal", or as the opening of any reflection cycle. The accepted
// rate per kind tells JARVIS where it's matching the user's voice.

import { z } from "zod";
import { defineTool } from "./types";

const VALID_KINDS = ["reflection", "standup", "intention", "win", "checkin"] as const;
const VALID_STATUSES = ["all", "shown", "accepted", "edited", "rejected", "superseded"] as const;
const RESOLVE_STATUSES = ["accepted", "edited", "rejected"] as const;

type PreWriteRow = {
  id: string;
  kind: string;
  subkind: string | null;
  draft_body: Record<string, unknown>;
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  status: string;
  accepted_id: string | null;
  user_score: number | null;
  user_note: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  resolved_at: string | null;
};

export const preWriteDraftTool = defineTool({
  name: "pre_write_draft",
  description: [
    "Draft what the user would PLAUSIBLY write next for one of their",
    "regular journals — reflection, standup, intention, win, or checkin —",
    "in their own voice, based on recent state. Inverts the blank-page",
    "problem: the form opens already pre-filled, the user edits instead",
    "of starting from scratch.",
    "",
    "Required: kind — one of reflection | standup | intention | win |",
    "checkin. Optional: subkind (e.g. 'lesson' for a reflection).",
    "",
    "Returns the new pre_write id and the drafted fields (kind-specific).",
    "The draft is NOT auto-saved as a real entry — the user resolves it",
    "via resolve_pre_write once they've accepted/edited/rejected.",
    "",
    "Use when the user says 'draft my standup', 'write my reflection',",
    "'what would I journal today', 'I don't know where to start'. Don't",
    "call casually — each draft costs an LLM round-trip.",
  ].join("\n"),
  schema: z.object({
    kind: z.enum(VALID_KINDS),
    subkind: z.string().max(32).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: [...VALID_KINDS] },
      subkind: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/pre-write`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ kind: input.kind, subkind: input.subkind }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `draft failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { pre_write?: PreWriteRow };
    if (!j.pre_write) return { ok: false, error: "no draft produced" };

    return {
      ok: true,
      pre_write: {
        id: j.pre_write.id,
        kind: j.pre_write.kind,
        subkind: j.pre_write.subkind,
        draft: j.pre_write.draft_body,
        source_summary: j.pre_write.source_summary,
        latency_ms: j.pre_write.latency_ms,
        model: j.pre_write.model,
        created_at: j.pre_write.created_at,
      },
    };
  },
});

export const listPreWritesTool = defineTool({
  name: "list_pre_writes",
  description: [
    "List the user's recent pre-write drafts. Optional: status (all |",
    "shown | accepted | edited | rejected | superseded, default all);",
    "kind (reflection | standup | intention | win | checkin | all,",
    "default all); limit (default 20, max 100).",
    "",
    "Includes per-kind acceptance stats (shown/accepted/edited/rejected",
    "counts) so you can see where JARVIS is matching the user's voice",
    "and where it isn't.",
    "",
    "Use when the user asks 'show me my drafts', 'what did you draft for",
    "me yesterday', 'how often do I accept your drafts', 'which kind",
    "are you bad at predicting'.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(VALID_STATUSES).optional().default("all"),
    kind: z.enum(["all", ...VALID_KINDS] as [string, ...string[]]).optional().default("all"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: [...VALID_STATUSES] },
      kind: { type: "string", enum: ["all", ...VALID_KINDS] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "all";
    const kind = input.kind ?? "all";
    const limit = Math.max(1, Math.min(100, input.limit ?? 20));

    let q = ctx.supabase
      .from("pre_writes")
      .select("id, kind, subkind, draft_body, source_summary, source_counts, status, accepted_id, user_score, user_note, latency_ms, model, created_at, resolved_at")
      .eq("user_id", ctx.userId);
    if (status !== "all") q = q.eq("status", status);
    if (kind !== "all") q = q.eq("kind", kind);
    q = q.order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as PreWriteRow[];

    const acceptanceByKind: Record<string, { shown: number; accepted: number; edited: number; rejected: number; useful_rate: number | null }> = {};
    for (const r of rows) {
      const k = r.kind;
      if (!acceptanceByKind[k]) acceptanceByKind[k] = { shown: 0, accepted: 0, edited: 0, rejected: 0, useful_rate: null };
      const bucket = acceptanceByKind[k];
      if (!bucket) continue;
      if (r.status === "shown" || r.status === "superseded") bucket.shown++;
      else if (r.status === "accepted") bucket.accepted++;
      else if (r.status === "edited") bucket.edited++;
      else if (r.status === "rejected") bucket.rejected++;
    }
    for (const k of Object.keys(acceptanceByKind)) {
      const a = acceptanceByKind[k];
      if (!a) continue;
      const total = a.shown + a.accepted + a.edited + a.rejected;
      a.useful_rate = total > 0 ? Math.round(((a.accepted + a.edited) / total) * 100) : null;
    }

    return {
      ok: true,
      count: rows.length,
      pre_writes: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        subkind: r.subkind,
        draft: r.draft_body,
        status: r.status,
        accepted_id: r.accepted_id,
        user_score: r.user_score,
        user_note: r.user_note,
        source_summary: r.source_summary,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
      })),
      acceptance_by_kind: acceptanceByKind,
    };
  },
});

export const resolvePreWriteTool = defineTool({
  name: "resolve_pre_write",
  description: [
    "Mark a pre-write draft as accepted (used as-is), edited (used after",
    "the user reshaped it), or rejected (user threw it away). Optional:",
    "user_score (1-5, how well JARVIS matched the user's voice);",
    "user_note (free-text feedback, e.g. 'too formal', 'spot on'); and",
    "accepted_id (the uuid of the resulting reflection/standup/etc row,",
    "if known) so the loop closes.",
    "",
    "Use this when the user explicitly tells you what they did with a",
    "draft ('I used your draft as-is', 'your standup was wrong, I",
    "rewrote it', 'reject that one'). Don't guess — ask if unclear.",
  ].join("\n"),
  schema: z.object({
    pre_write_id: z.string().uuid(),
    status: z.enum(RESOLVE_STATUSES),
    accepted_id: z.string().uuid().optional(),
    user_score: z.number().int().min(1).max(5).optional(),
    user_note: z.string().max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["pre_write_id", "status"],
    properties: {
      pre_write_id: { type: "string" },
      status: { type: "string", enum: [...RESOLVE_STATUSES] },
      accepted_id: { type: "string" },
      user_score: { type: "number" },
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

    const body: Record<string, unknown> = { status: input.status };
    if (input.accepted_id) body.accepted_id = input.accepted_id;
    if (input.user_score != null) body.user_score = input.user_score;
    if (input.user_note) body.user_note = input.user_note;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/pre-write/${input.pre_write_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `resolve failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { pre_write?: { id: string; status: string; resolved_at: string | null } };
    if (!j.pre_write) return { ok: false, error: "no row returned" };
    return { ok: true, pre_write: j.pre_write };
  },
});
