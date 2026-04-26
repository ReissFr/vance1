// Brain tools for CEO MODE / VENTURES (§181) — businesses JARVIS is
// running on the user's behalf.
//
// Each venture has a thesis, a budget, a decision_matrix (auto/notify
// /approve tiers), an operator_memory (living strategy doc), and a
// cadence (how often the operator loop fires). The loop pulls signals
// + metrics + recent decisions, asks Haiku for ranked operational
// decisions, classifies each into a tier, and either fires it silently
// (auto), fires + pings WhatsApp (notify), or queues for the user's
// approval.

import { z } from "zod";
import { defineTool, type ToolContext } from "./types";

function getBaseUrlAndAuth(ctx: ToolContext): { baseUrl: string; auth: string } | { error: string } {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
  if (!baseUrl) return { error: "APP_URL not configured" };
  const auth = (
    ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
  ).rest?.headers?.Authorization;
  if (!auth) return { error: "no session token" };
  return { baseUrl: baseUrl.replace(/\/$/, ""), auth };
}

const VENTURE_STATUS = ["researching", "validated", "building", "launched", "scaling", "paused", "killed"] as const;
const CADENCE = ["daily", "twice_daily", "hourly", "weekly", "manual"] as const;
const SIGNAL_KIND = [
  "customer_email", "support_ticket", "churn_event", "competitor_move",
  "metric_anomaly", "calendar_conflict", "review", "feature_request",
  "cancellation_reason", "press_mention", "social_mention", "other",
] as const;
const METRIC_KIND = [
  "revenue_pence", "spend_pence", "mrr_pence", "arr_pence",
  "paying_customers", "free_users", "mau", "wau", "dau",
  "conversion_rate", "churn_rate", "nps",
  "page_views", "signups", "cac_pence", "ltv_pence",
  "support_tickets_open", "runway_days", "other",
] as const;

export const switchModeTool = defineTool({
  name: "switch_mode",
  description: [
    "Switch the user's JARVIS mode between ASSISTANT and CEO.",
    "",
    "ASSISTANT mode is the default — JARVIS responds to requests, runs",
    "errands, manages the user's day.",
    "",
    "CEO mode adds the VENTURES surface — JARVIS is autonomously running",
    "businesses for the user, firing operator-loop heartbeats, classifying",
    "decisions into auto/notify/approve tiers per venture's decision",
    "matrix. The user chairs the board, JARVIS runs the floor.",
    "",
    "Use when the user says 'switch to CEO mode', 'put me in assistant",
    "mode', 'turn on CEO mode', 'I want to run businesses through you'.",
    "Auto-suggest CEO mode if the user says they want JARVIS to operate",
    "businesses for them — ALWAYS confirm the mode switch first.",
  ].join("\n"),
  schema: z.object({
    mode: z.enum(["assistant", "ceo"]),
  }),
  inputSchema: {
    type: "object",
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["assistant", "ceo"] },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/mode`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify({ mode: input.mode }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `mode switch failed (${r.status})` };
    return { ok: true, mode: input.mode };
  },
});

export const createVentureTool = defineTool({
  name: "create_venture",
  description: [
    "Charter a new venture for JARVIS to run on the user's behalf.",
    "Required: name (2-80) + thesis (20-2000 — what this is, who it's",
    "for, why now, what the wedge is). Optional: budget_pence, cadence",
    "(daily / twice_daily / hourly / weekly / manual — default daily),",
    "kill_criteria, decision_matrix (auto/notify/approve tiers).",
    "",
    "After creation, the operator-loop is scheduled to fire on cadence.",
    "Use when the user says 'start a new venture', 'jarvis run a business",
    "for me doing X', 'I want to test selling Y'.",
  ].join("\n"),
  schema: z.object({
    name: z.string().min(2).max(80),
    thesis: z.string().min(20).max(2000),
    budget_pence: z.number().int().min(0).optional(),
    cadence: z.enum(CADENCE).optional(),
    kill_criteria: z.string().max(2000).optional(),
    status: z.enum(VENTURE_STATUS).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["name", "thesis"],
    properties: {
      name: { type: "string" },
      thesis: { type: "string" },
      budget_pence: { type: "number", description: "Total budget in pence (e.g. 50000 = £500)" },
      cadence: { type: "string", enum: CADENCE as unknown as string[] },
      kill_criteria: { type: "string" },
      status: { type: "string", enum: VENTURE_STATUS as unknown as string[] },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify(input),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `create failed (${r.status})` };
    return { ok: true, venture: j.venture };
  },
});

export const listVenturesTool = defineTool({
  name: "list_ventures",
  description: [
    "List the user's ventures with portfolio stats: total budget, total",
    "spent, queued decisions across all ventures, status breakdown.",
    "Per-venture: runway, queued decisions, recent decisions (7d),",
    "unprocessed signals, latest revenue.",
    "",
    "Use when the user asks 'what businesses am I running', 'how are my",
    "ventures doing', 'show me the portfolio', 'what's queued for me'.",
  ].join("\n"),
  schema: z.object({
    status: z.enum([...VENTURE_STATUS, "all"]).optional().default("all"),
    include_killed: z.boolean().optional().default(false),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: [...VENTURE_STATUS, "all"] as unknown as string[] },
      include_killed: { type: "boolean" },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const params = new URLSearchParams();
    if (input.status && input.status !== "all") params.set("status", input.status);
    if (input.include_killed) params.set("include_killed", "true");
    const r = await fetch(`${conn.baseUrl}/api/ventures?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: conn.auth },
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `list failed (${r.status})` };
    return { ok: true, count: j.ventures?.length ?? 0, stats: j.stats, ventures: j.ventures ?? [] };
  },
});

export const getVentureTool = defineTool({
  name: "get_venture",
  description: [
    "Get full venture record + last 50 decisions + last 50 signals + last",
    "200 metrics. Use when the user asks 'how's the X venture', 'what's",
    "happening with Y', 'give me the full picture on Z'.",
  ].join("\n"),
  schema: z.object({ venture_id: z.string().uuid() }),
  inputSchema: {
    type: "object",
    required: ["venture_id"],
    properties: { venture_id: { type: "string" } },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}`, {
      method: "GET",
      headers: { Authorization: conn.auth },
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `get failed (${r.status})` };
    return { ok: true, venture: j.venture, decisions: j.decisions ?? [], signals: j.signals ?? [], metrics: j.metrics ?? [] };
  },
});

export const runOperatorLoopTool = defineTool({
  name: "run_operator_loop",
  description: [
    "Fire one heartbeat of the operator loop for a venture. JARVIS pulls",
    "unprocessed signals + recent metrics + recent decisions, asks Haiku",
    "for ranked operational decisions, classifies each into auto/notify/",
    "approve tiers per the decision_matrix, executes auto-tier silently,",
    "fires + WhatsApps notify-tier, queues approve-tier.",
    "",
    "Use when the user says 'run the operator loop', 'fire a heartbeat",
    "on X', 'have jarvis run a tick on the venture'. Costs an LLM call",
    "(15-30s). Returns counts + the proposed decisions.",
  ].join("\n"),
  schema: z.object({ venture_id: z.string().uuid() }),
  inputSchema: {
    type: "object",
    required: ["venture_id"],
    properties: { venture_id: { type: "string" } },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}/operator-loop`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: "{}",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `loop failed (${r.status})` };
    return {
      ok: true,
      heartbeat_id: j.heartbeat_id,
      model: j.model,
      latency_ms: j.latency_ms,
      signals_consumed: j.signals_consumed,
      decisions_proposed: j.decisions_proposed,
      auto_fired: j.auto_fired,
      notified: j.notified,
      queued: j.queued,
      decisions: j.decisions ?? [],
    };
  },
});

export const proposeDecisionTool = defineTool({
  name: "propose_decision",
  description: [
    "Manually propose a decision for a venture (without firing the full",
    "operator loop). The user, or JARVIS reasoning outside the loop, may",
    "want to add a decision directly. Defaults to tier='approve' (queues",
    "for user review).",
    "",
    "Use sparingly — the operator-loop is the primary entry. Use this for",
    "discrete asks like 'add a decision to bump prices on the lite plan'.",
  ].join("\n"),
  schema: z.object({
    venture_id: z.string().uuid(),
    kind: z.string().min(2).max(80),
    title: z.string().min(2).max(280),
    body: z.string().min(4).max(4000),
    reasoning: z.string().max(2000).optional(),
    estimated_spend_pence: z.number().int().min(0).optional(),
    confidence: z.number().int().min(1).max(5).optional(),
    tier: z.enum(["auto", "notify", "approve"]).optional().default("approve"),
  }),
  inputSchema: {
    type: "object",
    required: ["venture_id", "kind", "title", "body"],
    properties: {
      venture_id: { type: "string" },
      kind: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      reasoning: { type: "string" },
      estimated_spend_pence: { type: "number" },
      confidence: { type: "number" },
      tier: { type: "string", enum: ["auto", "notify", "approve"] },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify(input),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `propose failed (${r.status})` };
    return { ok: true, decision: j.decision };
  },
});

export const respondToDecisionTool = defineTool({
  name: "respond_to_decision",
  description: [
    "Respond to a venture decision. Modes:",
    "  approve   — user approves a queued decision (status queued→approved)",
    "  reject    — user rejects a queued decision",
    "  override  — user retroactively reverses an auto/notify decision.",
    "              REQUIRES override_note (≥4 chars) explaining what should",
    "              have happened instead — read into next heartbeat as",
    "              feedback so the loop learns.",
    "  execute   — mark approved decision as executed",
    "  fail      — mark as failed; optional outcome_note",
    "  cancel    — cancel a queued decision",
    "  outcome   — log outcome_note without status change",
    "",
    "Use when the user replies to a queued/notified decision: 'approve",
    "the price bump', 'reject the new ad campaign', 'override the support",
    "reply — should have been gentler', 'mark the partnership outreach",
    "as executed'.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("approve"), venture_id: z.string().uuid(), decision_id: z.string().uuid(), note: z.string().max(2000).optional() }),
    z.object({ mode: z.literal("reject"), venture_id: z.string().uuid(), decision_id: z.string().uuid(), note: z.string().max(2000).optional() }),
    z.object({ mode: z.literal("override"), venture_id: z.string().uuid(), decision_id: z.string().uuid(), override_note: z.string().min(4).max(2000) }),
    z.object({ mode: z.literal("execute"), venture_id: z.string().uuid(), decision_id: z.string().uuid(), outcome_postmortem_days: z.number().int().min(1).max(180).optional() }),
    z.object({ mode: z.literal("fail"), venture_id: z.string().uuid(), decision_id: z.string().uuid(), outcome_note: z.string().max(2000).optional() }),
    z.object({ mode: z.literal("cancel"), venture_id: z.string().uuid(), decision_id: z.string().uuid() }),
    z.object({ mode: z.literal("outcome"), venture_id: z.string().uuid(), decision_id: z.string().uuid(), outcome_note: z.string().min(2).max(2000) }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "venture_id", "decision_id"],
    properties: {
      mode: { type: "string", enum: ["approve", "reject", "override", "execute", "fail", "cancel", "outcome"] },
      venture_id: { type: "string" },
      decision_id: { type: "string" },
      note: { type: "string" },
      override_note: { type: "string", description: "REQUIRED for override (≥4 chars). What should have happened instead." },
      outcome_note: { type: "string" },
      outcome_postmortem_days: { type: "number" },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const body: Record<string, unknown> = { mode: input.mode };
    if (input.mode === "approve" || input.mode === "reject") {
      if (input.note) body.note = input.note;
    } else if (input.mode === "override") {
      body.override_note = input.override_note;
    } else if (input.mode === "execute") {
      if (input.outcome_postmortem_days) body.outcome_postmortem_days = input.outcome_postmortem_days;
    } else if (input.mode === "fail") {
      if (input.outcome_note) body.outcome_note = input.outcome_note;
    } else if (input.mode === "outcome") {
      body.outcome_note = input.outcome_note;
    }
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}/decisions/${input.decision_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `respond failed (${r.status})` };
    return { ok: true, decision: j.decision };
  },
});

export const logSignalTool = defineTool({
  name: "log_signal",
  description: [
    "Log a signal for a venture — anything the operator loop should",
    "weigh next heartbeat. Customer emails, support tickets, churn events,",
    "competitor moves, metric anomalies, reviews, feature requests, press",
    "mentions, social mentions.",
    "",
    "weight 1-5 (default 3) — bigger weight, more pull on next heartbeat.",
    "",
    "Use when the user says 'log a signal — customer X complained about",
    "Y', 'jarvis note that competitor Z just shipped W'.",
  ].join("\n"),
  schema: z.object({
    venture_id: z.string().uuid(),
    kind: z.enum(SIGNAL_KIND),
    body: z.string().min(2).max(4000),
    source: z.string().max(500).optional(),
    weight: z.number().int().min(1).max(5).optional().default(3),
  }),
  inputSchema: {
    type: "object",
    required: ["venture_id", "kind", "body"],
    properties: {
      venture_id: { type: "string" },
      kind: { type: "string", enum: SIGNAL_KIND as unknown as string[] },
      body: { type: "string" },
      source: { type: "string" },
      weight: { type: "number" },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}/signals`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify(input),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `log failed (${r.status})` };
    return { ok: true, signal: j.signal };
  },
});

export const logMetricTool = defineTool({
  name: "log_metric",
  description: [
    "Log a metric measurement for a venture. metric_kind enum covers",
    "revenue/spend/MRR/ARR (in pence), paying customers, free users,",
    "MAU/WAU/DAU, conversion/churn rates, NPS, page views, signups,",
    "CAC/LTV (in pence), open support tickets, runway days. Money values",
    "are PENCE (e.g. 12345 = £123.45). Rates are decimals (0.05 = 5%).",
    "",
    "Use when the user says 'log MRR is now £820', 'add this week's signups",
    "as 47', 'churn ticked up to 6%'. captured_for_date defaults to today.",
  ].join("\n"),
  schema: z.object({
    venture_id: z.string().uuid(),
    metric_kind: z.enum(METRIC_KIND),
    value: z.number(),
    unit: z.string().max(40).optional(),
    note: z.string().max(1000).optional(),
    captured_for_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD").optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["venture_id", "metric_kind", "value"],
    properties: {
      venture_id: { type: "string" },
      metric_kind: { type: "string", enum: METRIC_KIND as unknown as string[] },
      value: { type: "number" },
      unit: { type: "string" },
      note: { type: "string" },
      captured_for_date: { type: "string", description: "YYYY-MM-DD; defaults to today" },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}/metrics`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify(input),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `log failed (${r.status})` };
    return { ok: true, metric: j.metric };
  },
});

export const updateVentureTool = defineTool({
  name: "update_venture",
  description: [
    "Update a venture's name, thesis, status, budget, spent, kill_criteria,",
    "operator_memory, cadence, decision_matrix. Bumping the thesis bumps",
    "thesis_revision. Changing status to 'launched' stamps launched_at.",
    "",
    "operator_memory is the LIVING STRATEGY DOC the operator loop reads",
    "every heartbeat — append context, change strategy, prune stale notes.",
    "Capped at 50k chars (older content trimmed automatically).",
    "",
    "Use when the user says 'change the thesis to X', 'pause the venture',",
    "'bump the budget to £2k', 'switch to weekly cadence', 'add a note to",
    "operator memory about Y'.",
  ].join("\n"),
  schema: z.object({
    venture_id: z.string().uuid(),
    name: z.string().min(2).max(80).optional(),
    thesis: z.string().min(20).max(2000).optional(),
    status: z.enum(VENTURE_STATUS).optional(),
    budget_pence: z.number().int().min(0).optional(),
    spent_pence: z.number().int().min(0).optional(),
    kill_criteria: z.string().max(2000).optional(),
    operator_memory: z.string().max(50000).optional(),
    cadence: z.enum(CADENCE).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["venture_id"],
    properties: {
      venture_id: { type: "string" },
      name: { type: "string" },
      thesis: { type: "string" },
      status: { type: "string", enum: VENTURE_STATUS as unknown as string[] },
      budget_pence: { type: "number" },
      spent_pence: { type: "number" },
      kill_criteria: { type: "string" },
      operator_memory: { type: "string" },
      cadence: { type: "string", enum: CADENCE as unknown as string[] },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const { venture_id, ...rest } = input;
    const r = await fetch(`${conn.baseUrl}/api/ventures/${venture_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify(rest),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `update failed (${r.status})` };
    return { ok: true, venture: j.venture };
  },
});

export const killVentureTool = defineTool({
  name: "kill_venture",
  description: [
    "Soft-kill a venture (status='killed' + killed_at + killed_reason).",
    "Stops further operator-loop heartbeats. Decisions / signals / metrics",
    "are preserved.",
    "",
    "Reason (≥4 chars) REQUIRED — the post-mortem is the value, not the",
    "shutdown.",
    "",
    "Use when the user says 'kill the X venture' / 'shut down Y' / 'this",
    "isn't working, kill it'. ALWAYS confirm before firing — killing is",
    "stoppable but feels final to the user.",
  ].join("\n"),
  schema: z.object({
    venture_id: z.string().uuid(),
    reason: z.string().min(4).max(2000),
  }),
  inputSchema: {
    type: "object",
    required: ["venture_id", "reason"],
    properties: {
      venture_id: { type: "string" },
      reason: { type: "string", description: "Why this venture is being killed (≥4 chars). Becomes the post-mortem record." },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify({ reason: input.reason }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `kill failed (${r.status})` };
    return { ok: true, venture: j.venture };
  },
});

const AUTONOMY_LEVELS = ["manual", "supervised", "autonomous", "full_autopilot"] as const;

export const setVentureAutonomyTool = defineTool({
  name: "set_venture_autonomy",
  description: [
    "Set how autonomously JARVIS runs one specific venture. Four levels:",
    "  manual         — JARVIS proposes decisions but every one queues for",
    "                   the user to approve. Heartbeat fires only on user",
    "                   request. Use for brand-new ventures where trust hasn't",
    "                   been earned yet.",
    "  supervised     — auto+notify-tier decisions execute via the errand",
    "                   substrate (silently / with WhatsApp ping); approve-tier",
    "                   queues. Heartbeat fires on user request only.",
    "  autonomous     — same dispatch as supervised, PLUS the heartbeat fires",
    "                   on the venture's cadence schedule without nudging.",
    "                   Default for trusted ventures.",
    "  full_autopilot — auto, notify AND approve-tier all dispatch through",
    "                   the errand substrate. Cron-fired. Use only when",
    "                   operator memory is rich enough that the user is",
    "                   comfortable with JARVIS making approve-tier calls",
    "                   (pivots, hires, contracts) without checking in.",
    "",
    "Always confirm with the user before escalating to full_autopilot — the",
    "blast radius of a bad call is large.",
  ].join("\n"),
  schema: z.object({
    venture_id: z.string().uuid(),
    autonomy: z.enum(AUTONOMY_LEVELS),
  }),
  inputSchema: {
    type: "object",
    required: ["venture_id", "autonomy"],
    properties: {
      venture_id: { type: "string" },
      autonomy: {
        type: "string",
        enum: [...AUTONOMY_LEVELS],
        description: "manual | supervised | autonomous | full_autopilot",
      },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/${input.venture_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify({ autonomy: input.autonomy }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `set autonomy failed (${r.status})` };
    return { ok: true, venture_id: input.venture_id, autonomy: input.autonomy };
  },
});

export const panicStopVenturesTool = defineTool({
  name: "panic_stop_ventures",
  description: [
    "GLOBAL kill switch for all venture autonomy. Sets ventures_panic_stop_at",
    "on the user's profile. While set:",
    "  - The cron poller skips every venture, regardless of per-venture",
    "    autonomy level.",
    "  - Heartbeats triggered manually still classify decisions but refuse",
    "    to dispatch any of them — everything queues.",
    "",
    "Use when the user says 'stop everything' / 'panic stop' / 'kill the",
    "ventures' / 'pause all autonomy'. Single button = total halt.",
    "",
    "Optional reason is recorded so the user can see WHY a future heartbeat",
    "is blocked. Cleared via clear_panic_stop.",
  ].join("\n"),
  schema: z.object({
    reason: z.string().max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why the panic stop is being triggered." },
    },
  },
  async run(input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/panic-stop`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: JSON.stringify({ reason: input.reason ?? null }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `panic stop failed (${r.status})` };
    return { ok: true, panic_stop_at: j.panic_stop_at, reason: j.reason };
  },
});

export const clearPanicStopTool = defineTool({
  name: "clear_panic_stop",
  description: [
    "Clear the global ventures panic stop. The cron poller resumes firing",
    "due heartbeats; manual heartbeats can dispatch again.",
    "",
    "Per-venture autonomy levels and per-venture pauses are NOT touched —",
    "only the global stop. Use when the user says 'resume autonomy' /",
    "'clear the panic stop' / 'we're good, JARVIS can act again'.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const conn = getBaseUrlAndAuth(ctx);
    if ("error" in conn) return { ok: false, error: conn.error };
    const r = await fetch(`${conn.baseUrl}/api/ventures/panic-clear`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: conn.auth },
      body: "{}",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) return { ok: false, error: j.error || `clear panic stop failed (${r.status})` };
    return { ok: true, cleared_at: j.cleared_at };
  },
});
