// Brain tools for THE THRESHOLD LEDGER (§169) — mining moments where the
// user crossed an INTERNAL LINE that past-self would not recognise. The
// temporal symmetry to §165 used_to (lost selves): thresholds mark NEW
// selves that emerged.
//
// The novel hook: charge — was this crossing GROWTH (a line crossed in
// the direction the user wanted) or DRIFT (a line crossed without
// consent, a worrying compromise)? Naming the difference is the
// self-authorship move.

import { z } from "zod";
import { defineTool } from "./types";

type Threshold = {
  id: string;
  scan_id: string;
  threshold_text: string;
  before_state: string;
  after_state: string;
  pivot_kind: string;
  charge: string;
  magnitude: number;
  domain: string;
  crossed_recency: string;
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: string;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  active: number;
  integrated: number;
  dismissed: number;
  disputed: number;
  pinned: number;
  growth: number;
  drift: number;
  mixed: number;
  high_magnitude: number;
  drift_active: number;
  growth_integrated: number;
  pivot_kind_counts: Record<string, number>;
  charge_by_pivot: Record<string, { growth: number; drift: number; mixed: number }>;
  most_recent_drift: { id: string; spoken_date: string } | null;
  biggest_growth: { id: string; spoken_date: string; magnitude: number } | null;
};

export const scanThresholdsTool = defineTool({
  name: "scan_thresholds",
  description: [
    "Mine the user's chats for THRESHOLD CROSSINGS — moments where they",
    "named crossing an INTERNAL LINE that past-self would not recognise.",
    "Triggers: 'I never thought I would', 'I would never have', 'first",
    "time I actually', 'I used to think I couldn't', 'now I'm someone",
    "who', 'since when did I', 'the old me would have'.",
    "",
    "For each crossing, captures: verbatim threshold_text, distilled",
    "before_state + after_state, pivot_kind (capability/belief/boundary/",
    "habit/identity/aesthetic/relational/material), charge (growth/",
    "drift/mixed), magnitude 1-5, domain, crossed_recency, confidence.",
    "",
    "The novel signal is CHARGE — growth vs drift. The same surface",
    "phrase 'I never thought I'd' can be a proud crossing or an alarmed",
    "one. Naming the difference is what turns this from passing utterance",
    "into self-knowledge.",
    "",
    "Costs an LLM call (10-25s). Default window 180 days; expand to 365",
    "or 730 if surfacing older crossings. Dedups by spoken_message_id.",
    "",
    "Use when the user asks 'how am I changing', 'what have I crossed',",
    "'who am I becoming', 'where have I drifted', 'what have I outgrown',",
    "or after a should-ledger or used-to scan to see the OPPOSITE register",
    "(what's emerged rather than what's been lost).",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(730).optional().default(180),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (30-730, default 180)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/thresholds/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 180 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `threshold scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      thresholds?: Threshold[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      thresholds: (j.thresholds ?? []).map((t) => ({
        id: t.id,
        threshold_text: t.threshold_text,
        before_state: t.before_state,
        after_state: t.after_state,
        pivot_kind: t.pivot_kind,
        charge: t.charge,
        magnitude: t.magnitude,
        domain: t.domain,
        crossed_recency: t.crossed_recency,
        confidence: t.confidence,
        spoken_date: t.spoken_date,
      })),
    };
  },
});

export const listThresholdsTool = defineTool({
  name: "list_thresholds",
  description: [
    "List threshold crossings in the user's ledger plus stats. Filters:",
    "  status        (active | integrated | dismissed | disputed |",
    "                 pinned | archived | all, default active)",
    "  pivot_kind    (capability | belief | boundary | habit | identity |",
    "                 aesthetic | relational | material | all)",
    "  charge        (growth | drift | mixed | all)",
    "  min_magnitude (1-5, default 1)",
    "  min_confidence(1-5, default 2)",
    "  limit         (default 30, max 200)",
    "",
    "Returns thresholds + stats including growth / drift / mixed counts,",
    "high_magnitude (mag>=4), drift_active (active drift crossings —",
    "things to look at), growth_integrated (growth crossings the user",
    "has owned as identity evidence), pivot_kind_counts,",
    "charge_by_pivot (which kinds of crossing are dominantly growth or",
    "drift in this user's life), most_recent_drift (latest active drift",
    "— flag for attention), biggest_growth (largest growth crossing —",
    "evidence to honour).",
    "",
    "Use when the user asks 'what crossings have I made', 'where have I",
    "drifted', 'what have I outgrown', 'show me my biggest growth', or",
    "as ID-evidence retrieval when the user is doubting themselves.",
    "",
    "When surfacing, QUOTE the threshold_text verbatim and read the",
    "before_state and after_state aloud — the diagnostic value is in",
    "seeing the contrast, not the abstract pivot_kind.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "integrated", "dismissed", "disputed", "pinned", "archived", "all"]).optional().default("active"),
    pivot_kind: z.enum(["capability", "belief", "boundary", "habit", "identity", "aesthetic", "relational", "material", "all"]).optional().default("all"),
    charge: z.enum(["growth", "drift", "mixed", "all"]).optional().default("all"),
    min_magnitude: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "integrated", "dismissed", "disputed", "pinned", "archived", "all"] },
      pivot_kind: { type: "string", enum: ["capability", "belief", "boundary", "habit", "identity", "aesthetic", "relational", "material", "all"] },
      charge: { type: "string", enum: ["growth", "drift", "mixed", "all"] },
      min_magnitude: { type: "number" },
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
    params.set("status", input.status ?? "active");
    params.set("pivot_kind", input.pivot_kind ?? "all");
    params.set("charge", input.charge ?? "all");
    params.set("min_magnitude", String(Math.max(1, Math.min(5, input.min_magnitude ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/thresholds?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { thresholds?: Threshold[]; stats?: Stats };
    const rows = j.thresholds ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      thresholds: rows.map((t) => ({
        id: t.id,
        threshold_text: t.threshold_text,
        before_state: t.before_state,
        after_state: t.after_state,
        pivot_kind: t.pivot_kind,
        charge: t.charge,
        magnitude: t.magnitude,
        domain: t.domain,
        crossed_recency: t.crossed_recency,
        confidence: t.confidence,
        status: t.status,
        status_note: t.status_note,
        spoken_date: t.spoken_date,
        pinned: t.pinned,
      })),
    };
  },
});

export const respondToThresholdTool = defineTool({
  name: "respond_to_threshold",
  description: [
    "Resolve, edit, or annotate a threshold crossing. Specify exactly one mode:",
    "",
    "  integrate     — user is OWNING this crossing as identity evidence.",
    "                  status_note IS the meaning the user attaches to the",
    "                  crossing (REQUIRED — server rejects empty).",
    "                  Examples:",
    "                    'first time I actually said no to my dad' ->",
    "                      integrate with status_note 'I am someone who",
    "                      can hold a line with my parents now. Evidence",
    "                      I am not 12 any more.'",
    "                    'I never thought I'd run my own thing' ->",
    "                      integrate with status_note 'I am a founder.",
    "                      It happened. Don't gaslight myself when I",
    "                      doubt it.'",
    "",
    "  dispute       — user pushes back on the framing. status_note IS",
    "                  the correction (REQUIRED — server rejects empty).",
    "                  Examples:",
    "                    'I never thought I'd quit' -> dispute with note",
    "                      'I had been thinking about quitting for two",
    "                      years. The crossing wasn't sudden. The",
    "                      before_state is wrong.'",
    "",
    "  dismiss       — false alarm / mis-extraction by the model.",
    "                  status_note optional.",
    "",
    "  unresolve     — return to active (clear resolution).",
    "  pin / unpin   — toggle pinned (pinned thresholds surface as",
    "                  identity-evidence shortcuts).",
    "  archive / restore.",
    "",
    "  edit          — fix mis-extracted facts. Optional fields:",
    "                  threshold_text, before_state, after_state, charge,",
    "                  magnitude. At least one required.",
    "",
    "Use ONLY after the user has stated a clear judgement on the crossing.",
    "Push for INTEGRATE on growth crossings — owning them is the",
    "anti-gaslighting move when the user starts doubting they've changed.",
    "When integrating, quote the threshold_text + after_state back so the",
    "user sees what they're claiming as evidence.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("integrate"),
      threshold_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what this crossing means as identity evidence) is required for integrate").max(1500),
    }),
    z.object({
      mode: z.literal("dispute"),
      threshold_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (how the framing is wrong) is required for dispute").max(1500),
    }),
    z.object({
      mode: z.literal("dismiss"),
      threshold_id: z.string().uuid(),
      status_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      threshold_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      threshold_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      threshold_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      threshold_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      threshold_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("edit"),
      threshold_id: z.string().uuid(),
      threshold_text: z.string().min(4).max(220).optional(),
      before_state: z.string().min(4).max(240).optional(),
      after_state: z.string().min(4).max(240).optional(),
      charge: z.enum(["growth", "drift", "mixed"]).optional(),
      magnitude: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "threshold_id"],
    properties: {
      mode: { type: "string", enum: ["integrate", "dispute", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      threshold_id: { type: "string" },
      status_note: { type: "string", description: "REQUIRED for integrate (what the crossing means as identity evidence) and dispute (how the framing is wrong); optional for dismiss." },
      threshold_text: { type: "string" },
      before_state: { type: "string" },
      after_state: { type: "string" },
      charge: { type: "string", enum: ["growth", "drift", "mixed"] },
      magnitude: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const body: Record<string, unknown> = { mode: input.mode };
    if (input.mode === "integrate" || input.mode === "dispute") {
      body.status_note = input.status_note;
    } else if (input.mode === "dismiss") {
      if (input.status_note) body.status_note = input.status_note;
    } else if (input.mode === "edit") {
      if (input.threshold_text) body.threshold_text = input.threshold_text;
      if (input.before_state) body.before_state = input.before_state;
      if (input.after_state) body.after_state = input.after_state;
      if (input.charge) body.charge = input.charge;
      if (typeof input.magnitude === "number") body.magnitude = input.magnitude;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/thresholds/${input.threshold_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { threshold?: Threshold };
    const t = j.threshold;
    if (!t) return { ok: false, error: "no threshold returned" };
    return {
      ok: true,
      threshold_id: t.id,
      status: t.status,
      status_note: t.status_note,
      pinned: t.pinned,
      archived_at: t.archived_at,
      threshold_text: t.threshold_text,
      before_state: t.before_state,
      after_state: t.after_state,
      charge: t.charge,
      magnitude: t.magnitude,
    };
  },
});
