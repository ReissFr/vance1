// Brain tools for the PHANTOM LIMB DETECTOR — things the user has CLAIMED to
// have moved on from, but keeps mentioning. Inverse of the promise ledger:
// promises are forward-looking ("I will do X"), phantom limbs are backward-
// looking ("I have done with X but haven't"). Mining the user's messages for
// the gap between what their words let go of and what their body still carries.

import { z } from "zod";
import { defineTool } from "./types";

type PostMention = { date: string; snippet: string; msg_id?: string };

type PhantomLimb = {
  id: string;
  scan_id: string;
  topic: string;
  topic_aliases: string[];
  claim_text: string;
  claim_kind: string;
  claim_date: string;
  claim_message_id: string | null;
  claim_conversation_id: string | null;
  days_since_claim: number;
  post_mention_count: number;
  post_mention_days: number;
  post_mentions: PostMention[];
  haunting_score: number;
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
  acknowledged: number;
  contested: number;
  resolved: number;
  dismissed: number;
  haunting_5: number;
  haunting_4: number;
};

export const scanPhantomLimbsTool = defineTool({
  name: "scan_phantom_limbs",
  description: [
    "Run a PHANTOM LIMB SCAN — mine the user's own messages for MOVE-ON",
    "claims ('I'm done with X', 'I've moved on from Y', 'I no longer think",
    "about Z', 'I let go of W') and count how many times the user has",
    "mentioned the same topic AFTER the claim. Surfaces the gap between",
    "what the user's words put down and what their body still carries.",
    "",
    "Use when the user asks 'what am I still carrying that I said I",
    "let go of', 'am I really over X', 'what do I keep bringing up',",
    "'show me what I've claimed to be done with'. Different from the",
    "Promise Ledger — that tracks 'I will do X' (forward-looking",
    "commitments). This tracks 'I have done with X' (backward-looking",
    "move-on claims) and whether they actually stuck.",
    "",
    "Optional: window_days (30-365, default 180). Costs an LLM round",
    "trip plus a substring search across messages (10-20s). Once a",
    "month is plenty.",
    "",
    "Returns the scan summary + the inserted phantom_limbs. The brain",
    "should follow up with list_phantom_limbs (status=pending,",
    "min_haunting=4) before discussing whether the user has 'moved on'",
    "from anything specific.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(365).optional(),
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/phantom-limbs/scan`, {
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
      phantom_limbs?: PhantomLimb[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      phantom_limbs: (j.phantom_limbs ?? []).map((p) => ({
        id: p.id,
        topic: p.topic,
        claim_kind: p.claim_kind,
        claim_text: p.claim_text,
        claim_date: p.claim_date,
        days_since_claim: p.days_since_claim,
        post_mention_count: p.post_mention_count,
        post_mention_days: p.post_mention_days,
        haunting_score: p.haunting_score,
      })),
    };
  },
});

export const listPhantomLimbsTool = defineTool({
  name: "list_phantom_limbs",
  description: [
    "List phantom limbs in the user's ledger plus stats.",
    "Optional: status (pending | acknowledged | contested | resolved",
    "| dismissed | pinned | archived | all, default pending),",
    "min_haunting (1-5, default 2 — filter trivial flickers; 4+ for",
    "the most load-bearing), limit (default 30, max 100).",
    "",
    "Returns rows + stats including haunting_5 and haunting_4 counts",
    "(the severely-haunting and strongly-haunting pending phantom",
    "limbs). The brain should reference these BEFORE accepting the",
    "user's claim of having 'moved on' from something — instead of",
    "reflecting their claim back to them, surface the receipts:",
    "'you said you're done with the agency 47 days ago, you've",
    "mentioned it 23 times since, in 14 different conversations. Want",
    "to look at what you've actually been saying?'",
    "",
    "Each phantom_limb returns: topic, claim_text (verbatim quote),",
    "claim_date, days_since_claim, post_mention_count, post_mentions",
    "(up to 8 most recent dated snippets — actual receipts), and",
    "haunting_score 1-5.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "acknowledged", "contested", "resolved", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    min_haunting: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "acknowledged", "contested", "resolved", "dismissed", "pinned", "archived", "all"] },
      min_haunting: { type: "number" },
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
    params.set("min_haunting", String(Math.max(1, Math.min(5, input.min_haunting ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/phantom-limbs?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { phantom_limbs?: PhantomLimb[]; stats?: Stats };
    const rows = j.phantom_limbs ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      phantom_limbs: rows.map((p) => ({
        id: p.id,
        topic: p.topic,
        claim_kind: p.claim_kind,
        claim_text: p.claim_text,
        claim_date: p.claim_date,
        days_since_claim: p.days_since_claim,
        post_mention_count: p.post_mention_count,
        post_mention_days: p.post_mention_days,
        haunting_score: p.haunting_score,
        post_mentions: (p.post_mentions ?? []).slice(0, 5).map((m) => ({ date: m.date, snippet: m.snippet })),
        status: p.status,
        status_note: p.status_note,
        pinned: p.pinned,
      })),
    };
  },
});

export const respondToPhantomLimbTool = defineTool({
  name: "respond_to_phantom_limb",
  description: [
    "Resolve or annotate a phantom limb. Specify exactly one mode:",
    "",
    "  acknowledged — user accepts they haven't actually let it go.",
    "  contested    — user disagrees the topic counts as a phantom limb.",
    "                 Use status_note to capture the user's reasoning.",
    "  resolved     — user has now actually let it go (post the scan).",
    "  dismissed    — irrelevant or false-positive. Use status_note.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use ONLY when the user has explicitly responded to a specific",
    "phantom limb. Don't guess the verdict on the user's behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["acknowledged", "contested", "resolved", "dismissed", "pin", "unpin", "archive", "restore"]),
    status_note: z.string().min(1).max(800).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["acknowledged", "contested", "resolved", "dismissed", "pin", "unpin", "archive", "restore"] },
      status_note: { type: "string" },
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
    if (["acknowledged", "contested", "resolved", "dismissed"].includes(input.mode)) {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/phantom-limbs/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { phantom_limb?: PhantomLimb };
    if (!j.phantom_limb) return { ok: false, error: "no row returned" };
    const p = j.phantom_limb;
    return {
      ok: true,
      phantom_limb: {
        id: p.id,
        topic: p.topic,
        claim_text: p.claim_text,
        haunting_score: p.haunting_score,
        status: p.status,
        status_note: p.status_note,
        pinned: p.pinned,
        archived: p.archived_at != null,
      },
    };
  },
});
