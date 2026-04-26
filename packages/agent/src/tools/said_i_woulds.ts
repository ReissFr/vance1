// Brain tools for THE SAID-I-WOULD LEDGER (§175) — the tiny casual promises
// the user makes in passing throughout the day. Distinct from §172 vows
// (formal promises-to-self), §168 shoulds (felt obligations), and the
// existing commitments table (commitments to others).
//
// Two novel hooks:
//   HORIZON INFERENCE          — model returns horizon_text + horizon_kind
//                                from the language ("tomorrow", "this
//                                weekend", "next month"). Server then
//                                computes target_date authoritatively from
//                                horizon_kind + spoken_date so the user
//                                never has to set a deadline.
//   FOLLOW-THROUGH CALIBRATION — kept / partial / broken / forgotten with
//                                rates broken down per domain and per
//                                horizon. The diagnostic value is the
//                                distinction between BROKEN (chose not to)
//                                and FORGOTTEN (didn't remember until
//                                prompted). Chronic forgetting is a
//                                different problem than chronic non-
//                                commitment and the rate-by-horizon tells
//                                you whether you're a tomorrow-person or a
//                                next-month-person.
//
// Most accountability software makes the user explicitly opt-in per goal;
// this captures from natural speech and grades it.

import { z } from "zod";
import { defineTool } from "./types";

type Promise = {
  id: string;
  scan_id: string;
  promise_text: string;
  horizon_text: string;
  horizon_kind: string;
  domain: string;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
  target_date: string;
  confidence: number;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  pending: number;
  kept: number;
  partial: number;
  broken: number;
  forgotten: number;
  dismissed: number;
  pinned: number;
  overdue_count: number;
  due_today: number;
  due_this_week: number;
  follow_through_rate: number;
  follow_through_loose: number;
  per_domain_rate: Record<string, { kept: number; total: number; rate: number }>;
  per_horizon_rate: Record<string, { kept: number; total: number; rate: number }>;
  by_domain: Record<string, number>;
  by_horizon: Record<string, number>;
  by_status: Record<string, number>;
};

export const scanSaidIWouldsTool = defineTool({
  name: "scan_said_i_woulds",
  description: [
    "Mine the user's chats for tiny CASUAL 'I'll' promises — 'I'll send",
    "that tomorrow', 'I'll call her this weekend', 'let me get back to you',",
    "'I'm going to fix this next week'. Distinct from formal vows / shoulds",
    "/ commitments-to-others. The model reads recent user messages, finds",
    "promise-shaped utterances, and infers a HORIZON from the language.",
    "",
    "For each promise captures: promise_text (4-280, what was said in the",
    "user's voice), horizon_text (1-80, the literal horizon phrase such as",
    "'tomorrow' or 'this weekend'), horizon_kind (today / tomorrow /",
    "this_week / this_weekend / next_week / this_month / next_month / soon /",
    "eventually / unspecified), domain (work / health / relationships /",
    "family / finance / creative / self / spiritual / other), spoken_date,",
    "spoken_message_id, confidence 1-5. The server then computes",
    "target_date AUTHORITATIVELY from horizon_kind + spoken_date so the",
    "user is held to the horizon they actually used.",
    "",
    "Costs an LLM call (10-25s). Default window 30 days. UPSERTs by",
    "(spoken_message_id, promise_text) so rescans don't duplicate.",
    "",
    "Use when the user asks 'what did I say I'd do', 'what have I promised',",
    "'what do I owe people', 'what's overdue', or as a follow-on to",
    "list_said_i_woulds when the ledger looks empty. Surface promise_text",
    "VERBATIM and ALWAYS name the target_date (not horizon_text) when",
    "asking the user to grade it — what was said is fixed; what now",
    "matters is whether the date arrived.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(7).max(90).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (7-90, default 30)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/said-i-would/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 30 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `said-i-would scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      skipped?: number;
      latency_ms?: number;
      message?: string;
      promises?: Promise[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      skipped: j.skipped ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      promises: (j.promises ?? []).map((p) => ({
        id: p.id,
        promise_text: p.promise_text,
        horizon_text: p.horizon_text,
        horizon_kind: p.horizon_kind,
        domain: p.domain,
        spoken_date: p.spoken_date,
        target_date: p.target_date,
        confidence: p.confidence,
      })),
    };
  },
});

export const listSaidIWouldsTool = defineTool({
  name: "list_said_i_woulds",
  description: [
    "List promises in the user's said-i-would ledger plus follow-through",
    "calibration stats. Filters:",
    "  status         (pending | kept | partial | broken | forgotten |",
    "                  dismissed | all, default pending)",
    "  horizon_kind   (today | tomorrow | this_week | this_weekend |",
    "                  next_week | this_month | next_month | soon |",
    "                  eventually | unspecified | all)",
    "  domain         (work | health | relationships | family | finance |",
    "                  creative | self | spiritual | other | all)",
    "  overdue        (true to filter pending past target_date)",
    "  due_within     (1-365, days from today)",
    "  pinned         (true to filter pinned only)",
    "  limit          (default 30, max 200)",
    "",
    "Returns promises + stats including overdue_count, due_today,",
    "due_this_week, follow_through_rate (kept/(kept+partial+broken+",
    "forgotten) * 100), follow_through_loose (kept+partial as a fraction of",
    "resolved), per_domain_rate, per_horizon_rate, by_status / by_domain /",
    "by_horizon buckets.",
    "",
    "Use when the user asks 'what's overdue', 'what did I say I'd do",
    "today', 'how good am I at following through', 'where do I break my",
    "promises', 'what have I forgotten'. Surface promise_text VERBATIM.",
    "ALWAYS name the target_date (not horizon_text) when surfacing pending",
    "promises — the date is the operative fact. When reporting follow-",
    "through, name the rate AND the per-horizon breakdown together: a 70%",
    "tomorrow rate next to a 20% next-month rate is the diagnostic.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "kept", "partial", "broken", "forgotten", "dismissed", "all"]).optional().default("pending"),
    horizon_kind: z.enum(["today", "tomorrow", "this_week", "this_weekend", "next_week", "this_month", "next_month", "soon", "eventually", "unspecified", "all"]).optional().default("all"),
    domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"]).optional().default("all"),
    overdue: z.boolean().optional().default(false),
    due_within: z.number().int().min(1).max(365).optional(),
    pinned: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "kept", "partial", "broken", "forgotten", "dismissed", "all"] },
      horizon_kind: { type: "string", enum: ["today", "tomorrow", "this_week", "this_weekend", "next_week", "this_month", "next_month", "soon", "eventually", "unspecified", "all"] },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"] },
      overdue: { type: "boolean" },
      due_within: { type: "number", description: "Days from today (1-365)" },
      pinned: { type: "boolean" },
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
    const status = input.status ?? "pending";
    if (status !== "all") params.set("status", status);
    if (input.horizon_kind && input.horizon_kind !== "all") params.set("horizon_kind", input.horizon_kind);
    if (input.domain && input.domain !== "all") params.set("domain", input.domain);
    if (input.overdue) params.set("overdue", "true");
    if (typeof input.due_within === "number") params.set("due_within", String(input.due_within));
    if (input.pinned) params.set("pinned", "true");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/said-i-would?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { promises?: Promise[]; stats?: Stats; today?: string };
    const rows = j.promises ?? [];
    return {
      ok: true,
      count: rows.length,
      today: j.today,
      stats: j.stats,
      promises: rows.map((p) => ({
        id: p.id,
        promise_text: p.promise_text,
        horizon_text: p.horizon_text,
        horizon_kind: p.horizon_kind,
        domain: p.domain,
        spoken_date: p.spoken_date,
        target_date: p.target_date,
        confidence: p.confidence,
        status: p.status,
        resolution_note: p.resolution_note,
        resolved_at: p.resolved_at,
        pinned: p.pinned,
      })),
    };
  },
});

export const respondToSaidIWouldTool = defineTool({
  name: "respond_to_said_i_would",
  description: [
    "Grade, edit, or annotate a promise in the said-i-would ledger.",
    "Specify exactly one mode:",
    "",
    "  kept       — the user did the thing. Optional resolution_note. Use",
    "               when they confirm completion.",
    "  partial    — they did some of it. Optional resolution_note. Use when",
    "               half-done — sent the message but didn't follow up,",
    "               started the workout but cut it short.",
    "  broken     — the user explicitly chose NOT to. Optional",
    "               resolution_note (why they chose not to). Use when they",
    "               name the choice — 'decided not to', 'changed my mind',",
    "               'wasn't right'. THIS IS DIFFERENT FROM FORGOTTEN.",
    "  forgotten  — the user didn't remember until prompted. Optional",
    "               resolution_note. Use when they say 'totally forgot',",
    "               'completely slipped my mind'. The distinction between",
    "               broken and forgotten is the novel diagnostic — chronic",
    "               forgetting is a working-memory / capture problem;",
    "               chronic broken is a commitment / values problem.",
    "  dismiss    — false positive from the scan. The promise wasn't a",
    "               promise.",
    "  unresolve  — return to pending (clears resolved_at and note).",
    "  pin / unpin — toggle pinned (pinned promises surface as shortcuts).",
    "  archive / restore — soft hide / un-hide.",
    "  reschedule — push target_date forward by N days. Body: {days: 1-365}.",
    "               Use when the user has explicitly extended their own",
    "               promise — 'I'll do it next week instead'. Don't use to",
    "               quietly hide overdue.",
    "  edit       — fix promise_text or resolution_note. ≥1 required.",
    "               promise_text is 4-280.",
    "",
    "Use only after the user has stated a clear stance. NEVER silently",
    "default — make the user pick between broken and forgotten when they",
    "didn't do it. The whole calibration depends on that distinction being",
    "honest.",
  ].join("\n"),
  schema: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("kept"),
      promise_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      action: z.literal("partial"),
      promise_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      action: z.literal("broken"),
      promise_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      action: z.literal("forgotten"),
      promise_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      action: z.literal("dismiss"),
      promise_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      action: z.literal("unresolve"),
      promise_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("pin"),
      promise_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("unpin"),
      promise_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("archive"),
      promise_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("restore"),
      promise_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("reschedule"),
      promise_id: z.string().uuid(),
      days: z.number().int().min(1).max(365),
    }),
    z.object({
      action: z.literal("edit"),
      promise_id: z.string().uuid(),
      promise_text: z.string().min(4).max(280).optional(),
      resolution_note: z.string().max(1500).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["action", "promise_id"],
    properties: {
      action: { type: "string", enum: ["kept", "partial", "broken", "forgotten", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "reschedule", "edit"] },
      promise_id: { type: "string" },
      resolution_note: { type: "string", description: "Optional context note. For broken: why they chose not to. For forgotten: ack. For partial: what got done." },
      promise_text: { type: "string", description: "Optional for edit — replacement promise phrasing (4-280 chars)." },
      days: { type: "number", description: "Required for reschedule — days to push target_date forward (1-365)." },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const body: Record<string, unknown> = { action: input.action };
    if (input.action === "kept" || input.action === "partial" || input.action === "broken" || input.action === "forgotten" || input.action === "dismiss") {
      if (input.resolution_note) body.resolution_note = input.resolution_note;
    } else if (input.action === "reschedule") {
      body.days = input.days;
    } else if (input.action === "edit") {
      if (input.promise_text) body.promise_text = input.promise_text;
      if (input.resolution_note) body.resolution_note = input.resolution_note;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/said-i-would/${input.promise_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { promise?: Promise };
    const p = j.promise;
    if (!p) return { ok: false, error: "no promise returned" };
    return {
      ok: true,
      promise_id: p.id,
      status: p.status,
      promise_text: p.promise_text,
      horizon_kind: p.horizon_kind,
      target_date: p.target_date,
      resolution_note: p.resolution_note,
      resolved_at: p.resolved_at,
      pinned: p.pinned,
      archived_at: p.archived_at,
    };
  },
});
