// Brain tools for the PIVOT MAP — the moments the user TURNED. Verbal pivots
// ("actually", "scrap that"), stance reversals ("I was wrong about X"),
// abandonments ("I'm dropping the agency idea"), recommitments ("I'm going
// back to X properly this time"), thematic pivots. Plus deterministic
// follow-through and back-slide counts so the brain knows whether the pivot
// stuck or whether the user has been quietly sliding back.

import { z } from "zod";
import { defineTool } from "./types";

type Sample = { date: string; snippet: string };

type Pivot = {
  id: string;
  scan_id: string;
  pivot_text: string;
  pivot_kind: string;
  domain: string;
  pivot_date: string;
  pivot_message_id: string | null;
  pivot_conversation_id: string | null;
  from_state: string;
  to_state: string;
  from_aliases: string[];
  to_aliases: string[];
  days_since_pivot: number;
  follow_through_count: number;
  follow_through_days: number;
  back_slide_count: number;
  back_slide_days: number;
  follow_through_samples: Sample[];
  back_slide_samples: Sample[];
  pivot_quality: string;
  confidence: number;
  status: string;
  status_note: string | null;
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
  superseded: number;
  dismissed: number;
  quality: { stuck: number; performed: number; reverted: number; quiet: number; too_recent: number };
  domain_counts: Record<string, number>;
};

export const scanPivotMapTool = defineTool({
  name: "scan_pivot_map",
  description: [
    "Run a PIVOT MAP SCAN — mine the user's own messages for INFLECTION",
    "MOMENTS where they changed direction. Five kinds of pivot:",
    "  verbal           — explicit ('actually', 'scrap that', 'new plan')",
    "  thematic         — topic warm last week, cold this week",
    "  stance_reversal  — 'I was wrong about X', 'I've come round to X'",
    "  abandonment      — 'I'm dropping/killing/no longer chasing X'",
    "  recommitment     — 'going back to X properly this time'",
    "",
    "After extraction the server counts (deterministically):",
    "  follow_through_count = mentions of NEW direction since pivot",
    "  back_slide_count     = mentions of OLD direction since pivot",
    "and derives pivot_quality:",
    "  stuck       = follow-through ≥3 and ≥2x back-slide",
    "  performed   = ≤1 mention of either side (vapour pivot)",
    "  reverted    = back-slide outweighs follow-through",
    "  quiet       = small signals on both sides",
    "  too_recent  = <7 days since pivot, can't tell yet",
    "",
    "Use when the user asks 'what pivots have I made', 'did I actually",
    "follow through on X', 'have I been sliding back', 'show me the",
    "moments I turned'. Different from the Promise Ledger (forward",
    "commitments) and Phantom Limbs (move-on claims). This tracks",
    "DIRECTIONAL CHANGES specifically.",
    "",
    "Optional: window_days (30-365, default 120). Costs an LLM round",
    "trip plus a substring scan (10-25s). Once a fortnight is plenty.",
    "",
    "Returns the scan summary + the inserted pivots. The brain should",
    "follow up with list_pivot_map (quality=reverted or performed)",
    "BEFORE accepting the user's claim that they 'pivoted' or",
    "'changed direction' on something — instead of nodding along,",
    "surface the receipts.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/pivot-map/scan`, {
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
      pivots?: Pivot[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      pivots: (j.pivots ?? []).map((p) => ({
        id: p.id,
        pivot_kind: p.pivot_kind,
        domain: p.domain,
        pivot_date: p.pivot_date,
        days_since_pivot: p.days_since_pivot,
        from_state: p.from_state,
        to_state: p.to_state,
        follow_through_count: p.follow_through_count,
        back_slide_count: p.back_slide_count,
        pivot_quality: p.pivot_quality,
        confidence: p.confidence,
      })),
    };
  },
});

export const listPivotMapTool = defineTool({
  name: "list_pivot_map",
  description: [
    "List pivots in the user's pivot map plus quality stats.",
    "Optional filters:",
    "  status  (pending | acknowledged | contested | superseded |",
    "          dismissed | pinned | archived | all, default pending)",
    "  quality (stuck | performed | reverted | quiet | too_recent |",
    "          all, default all)",
    "  domain  (work | relationships | health | identity | finance |",
    "          creative | learning | daily | other | all, default all)",
    "  min_confidence (1-5, default 2)",
    "  limit   (default 30, max 100)",
    "",
    "Returns rows + stats including quality counts (stuck / reverted /",
    "performed / quiet / too_recent) and per-domain counts. The brain",
    "should reference these BEFORE accepting the user's claim of having",
    "'pivoted' or 'changed direction'. Surface the receipts:",
    "  'you said you were going back to the agency 22 days ago — but",
    "   I've counted 11 mentions of the agency since (the OLD direction)",
    "   and 2 of the new direction. That looks like a reverted pivot.",
    "   Want to look at what you've actually been saying?'",
    "",
    "Each pivot returns: pivot_kind, domain, pivot_date, days_since_pivot,",
    "from_state, to_state, follow_through_count + samples, back_slide_count",
    "+ samples, pivot_quality, confidence.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "acknowledged", "contested", "superseded", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    quality: z.enum(["stuck", "performed", "reverted", "quiet", "too_recent", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "acknowledged", "contested", "superseded", "dismissed", "pinned", "archived", "all"] },
      quality: { type: "string", enum: ["stuck", "performed", "reverted", "quiet", "too_recent", "all"] },
      domain: { type: "string", enum: ["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"] },
      min_confidence: { type: "number" },
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
    params.set("quality", input.quality ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/pivot-map?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { pivots?: Pivot[]; stats?: Stats };
    const rows = j.pivots ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      pivots: rows.map((p) => ({
        id: p.id,
        pivot_kind: p.pivot_kind,
        domain: p.domain,
        pivot_date: p.pivot_date,
        days_since_pivot: p.days_since_pivot,
        from_state: p.from_state,
        to_state: p.to_state,
        pivot_text: p.pivot_text,
        follow_through_count: p.follow_through_count,
        follow_through_days: p.follow_through_days,
        back_slide_count: p.back_slide_count,
        back_slide_days: p.back_slide_days,
        follow_through_samples: (p.follow_through_samples ?? []).slice(0, 3),
        back_slide_samples: (p.back_slide_samples ?? []).slice(0, 3),
        pivot_quality: p.pivot_quality,
        confidence: p.confidence,
        status: p.status,
        status_note: p.status_note,
        pinned: p.pinned,
      })),
    };
  },
});

export const respondToPivotTool = defineTool({
  name: "respond_to_pivot",
  description: [
    "Resolve or annotate a pivot. Specify exactly one mode:",
    "",
    "  acknowledged — user accepts the verdict (e.g. 'yes that pivot was a",
    "                 vapour pivot' or 'yes I did slide back').",
    "  contested    — user disagrees with the verdict. status_note required.",
    "  superseded   — the pivot has been replaced by a newer pivot. (Useful",
    "                 when the user pivoted again on the same domain).",
    "  dismissed    — false positive / not actually a pivot.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use ONLY when the user has explicitly responded to a specific pivot.",
    "Don't guess the verdict on the user's behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["acknowledged", "contested", "superseded", "dismissed", "pin", "unpin", "archive", "restore"]),
    status_note: z.string().min(1).max(800).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["acknowledged", "contested", "superseded", "dismissed", "pin", "unpin", "archive", "restore"] },
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
    if (["acknowledged", "contested", "superseded", "dismissed"].includes(input.mode)) {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/pivot-map/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { pivot?: Pivot };
    if (!j.pivot) return { ok: false, error: "no row returned" };
    const p = j.pivot;
    return {
      ok: true,
      pivot: {
        id: p.id,
        pivot_kind: p.pivot_kind,
        domain: p.domain,
        from_state: p.from_state,
        to_state: p.to_state,
        pivot_quality: p.pivot_quality,
        status: p.status,
        status_note: p.status_note,
        pinned: p.pinned,
        archived: p.archived_at != null,
      },
    };
  },
});
