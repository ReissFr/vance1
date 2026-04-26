// Brain tools for THE OWED-TO-ME LEDGER (§178) — promises OTHERS made
// TO the user that they're implicitly waiting on. The clean inverse
// mirror of §175 said-i-would (which tracks promises BY the user).
//
// Captures the casual "she said she'd send it tomorrow" / "he promised
// he'd help" / "they said they'd get back to me" / "the contractor said
// he'd be done by Friday". The cognitive overhead of carrying an
// unfulfilled promise from someone else is real. Most users carry
// several silently.
//
// THE NOVEL DIAGNOSTIC FIELD is RELATIONSHIP_WITH (partner / parent /
// sibling / friend / colleague / boss / client / stranger / unknown).
// Cross-tab on this field surfaces the implicit pattern: who's been
// quietly taking up your bandwidth with unkept promises?
//
// THE NOVEL RESOLUTION is RAISED. Refuses the binary of "wait quietly
// forever / get angry and burn it down". RAISED means: the user brought
// it up, named the unmet promise, made the conversation. The cognitive
// weight transfers from their head into a real exchange. Plus an
// optional raised_outcome enum tracking what happened afterwards —
// the diagnostic-of-the-diagnostic.

import { z } from "zod";
import { defineTool } from "./types";

type Owed = {
  id: string;
  scan_id: string | null;
  promise_text: string;
  horizon_text: string;
  horizon_kind: string;
  relationship_with: string;
  person_text: string | null;
  domain: string;
  charge: number;
  recency: string;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
  target_date: string;
  confidence: number;
  status: string;
  resolution_note: string | null;
  raised_outcome: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  open: number;
  kept: number;
  broken: number;
  forgotten: number;
  raised: number;
  released: number;
  dismissed: number;
  pinned: number;
  overdue_count: number;
  due_today: number;
  due_this_week: number;
  load_bearing_open: number;
  follow_through_received_rate: number;
  raised_follow_through_rate: number;
  per_relationship_rate: Record<string, { kept: number; total: number; rate: number }>;
  per_horizon_rate: Record<string, { kept: number; total: number; rate: number }>;
  relationship_counts: Record<string, number>;
  open_relationship_counts: Record<string, number>;
  raised_outcome_counts: Record<string, number>;
  most_common_open_relationship: null | string;
  least_promising_relationship: null | { relationship: string; rate: number; total: number };
  most_promising_relationship: null | { relationship: string; rate: number; total: number };
};

export const scanOwedToMeTool = defineTool({
  name: "scan_owed_to_me",
  description: [
    "Mine the user's chat for REPORTED PROMISES — utterances where the user",
    "is relaying something SOMEONE ELSE said they would do. Promises owed",
    "TO the user. The clean inverse mirror of said-i-woulds.",
    "",
    "Captures the casual 'she said she'd send it tomorrow' / 'he promised",
    "he'd help' / 'they said they'd get back to me' / 'the contractor said",
    "he'd be done by Friday'.",
    "",
    "For each captures: promise_text (the action distilled), horizon_text +",
    "horizon_kind (when), RELATIONSHIP_WITH (the novel diagnostic — partner",
    "/ parent / sibling / friend / colleague / boss / client / stranger /",
    "unknown), person_text (specific name when nameable), domain, charge",
    "1-5, recency, confidence, msg_id. Server computes target_date",
    "authoritatively from horizon_kind + spoken_date.",
    "",
    "Costs an LLM call (15-30s). Default window 60 days. Min 7 days.",
    "Won't insert duplicates already in the ledger (UPSERT-by",
    "msg_id+promise_text).",
    "",
    "Use when the user asks 'what am I waiting on', 'who hasn't got back",
    "to me', 'what promises are owed to me', 'who's quietly taking up my",
    "bandwidth'. Always name BOTH the person/role AND the relationship_with",
    "category — the diagnostic value is in surfacing the pattern.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(7).max(180).optional().default(60),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (7-180, default 60)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/owed-to-me/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 60 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `owed-to-me scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      owed_to_me?: Owed[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      owed_to_me: (j.owed_to_me ?? []).map((p) => ({
        id: p.id,
        promise_text: p.promise_text,
        horizon_text: p.horizon_text,
        horizon_kind: p.horizon_kind,
        relationship_with: p.relationship_with,
        person_text: p.person_text,
        domain: p.domain,
        charge: p.charge,
        confidence: p.confidence,
        spoken_date: p.spoken_date,
        target_date: p.target_date,
      })),
    };
  },
});

export const listOwedToMeTool = defineTool({
  name: "list_owed_to_me",
  description: [
    "List entries in the user's owed-to-me ledger plus stats. Filters:",
    "  status            (open | kept | broken | forgotten | raised |",
    "                     released | dismissed | pinned | archived | all,",
    "                     default open)",
    "  relationship_with (partner | parent | sibling | friend | colleague",
    "                     | boss | client | stranger | unknown | all)",
    "  domain            (work | health | relationships | family | finance",
    "                     | creative | self | spiritual | other | all)",
    "  min_charge        (1-5, default 1)",
    "  overdue           (true to show only open + target_date in the past)",
    "  due_within        (1-365 days; open + target_date in [today, +N])",
    "  pinned            (true to filter pinned only)",
    "  limit             (default 30, max 200)",
    "",
    "Returns rows + stats including load_bearing_open (charge ≥ 4),",
    "overdue_count, follow_through_received_rate (kept / (kept + broken +",
    "forgotten)) — THE CALIBRATION, per_relationship_rate (THE diagnostic:",
    "follow-through by who made the promise), open_relationship_counts",
    "(cross-tab — who's holding the most open promises to you),",
    "raised_follow_through_rate (of times user raised it, how often did",
    "they actually deliver), raised_outcome_counts.",
    "",
    "Use when the user asks 'who hasn't got back to me', 'what am I",
    "waiting on', 'who's quietly taking up my bandwidth', 'do my colleagues",
    "actually deliver what they promise'. ALWAYS surface the relationship",
    "pattern when reporting — the diagnostic value is in the cross-tab.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "kept", "broken", "forgotten", "raised", "released", "dismissed", "pinned", "archived", "all"]).optional().default("open"),
    relationship_with: z.enum(["partner", "parent", "sibling", "friend", "colleague", "boss", "client", "stranger", "unknown", "all"]).optional().default("all"),
    domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"]).optional().default("all"),
    min_charge: z.number().int().min(1).max(5).optional().default(1),
    overdue: z.boolean().optional().default(false),
    due_within: z.number().int().min(1).max(365).optional(),
    pinned: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "kept", "broken", "forgotten", "raised", "released", "dismissed", "pinned", "archived", "all"] },
      relationship_with: { type: "string", enum: ["partner", "parent", "sibling", "friend", "colleague", "boss", "client", "stranger", "unknown", "all"] },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"] },
      min_charge: { type: "number" },
      overdue: { type: "boolean" },
      due_within: { type: "number" },
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
    const status = input.status ?? "open";
    if (status !== "all") params.set("status", status);
    if (input.relationship_with && input.relationship_with !== "all") params.set("relationship_with", input.relationship_with);
    if (input.domain && input.domain !== "all") params.set("domain", input.domain);
    if (input.min_charge && input.min_charge > 1) params.set("min_charge", String(input.min_charge));
    if (input.overdue) params.set("overdue", "true");
    if (typeof input.due_within === "number") params.set("due_within", String(input.due_within));
    if (input.pinned) params.set("pinned", "true");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/owed-to-me?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { owed_to_me?: Owed[]; stats?: Stats; today?: string };
    const rows = j.owed_to_me ?? [];
    return {
      ok: true,
      count: rows.length,
      today: j.today,
      stats: j.stats,
      owed_to_me: rows.map((p) => ({
        id: p.id,
        promise_text: p.promise_text,
        horizon_text: p.horizon_text,
        horizon_kind: p.horizon_kind,
        relationship_with: p.relationship_with,
        person_text: p.person_text,
        domain: p.domain,
        charge: p.charge,
        confidence: p.confidence,
        spoken_date: p.spoken_date,
        target_date: p.target_date,
        status: p.status,
        resolution_note: p.resolution_note,
        raised_outcome: p.raised_outcome,
        pinned: p.pinned,
      })),
    };
  },
});

export const respondToOwedToMeTool = defineTool({
  name: "respond_to_owed_to_me",
  description: [
    "Resolve, edit, or annotate an entry in the owed-to-me ledger. Specify",
    "exactly one mode:",
    "",
    "  kept       — they did the thing. resolution_note optional (worth",
    "               capturing the tone — was it on time, late, awkward).",
    "",
    "  raised     — THE NOVEL RESOLUTION. The user brought it up, named the",
    "               unmet promise, made the conversation. Refuses the binary",
    "               of 'wait forever / burn it down'. resolution_note IS",
    "               what the user actually said when they raised it (REQUIRED",
    "               — server rejects empty). Optional secondary field:",
    "               raised_outcome (they_followed_through / they_apologized",
    "               / they_explained / they_dismissed_it / no_response).",
    "               This is the diagnostic-of-the-diagnostic — across the",
    "               times the user raised it, how often did the promiser",
    "               actually deliver afterwards?",
    "",
    "  broken     — they explicitly didn't follow through (named it,",
    "               declined). resolution_note IS what they said (REQUIRED).",
    "",
    "  forgotten  — they probably forgot; the user has decided to let it go",
    "               WITHOUT raising. resolution_note IS the user's read on",
    "               why and that they're letting it go (REQUIRED).",
    "",
    "  released   — the user has decided to stop expecting the thing to",
    "               happen. resolution_note optional (often there's a story",
    "               worth keeping).",
    "",
    "  dismiss    — false positive from the scan (not a real reported",
    "               promise).",
    "  unresolve  — return to open.",
    "  pin / unpin — toggle pinned.",
    "  archive / restore — soft hide / un-hide.",
    "  reschedule — push target_date by N days (1-365).",
    "  edit       — fix mis-extracted promise_text / relationship_with /",
    "               person_text / domain / charge. ≥1 required.",
    "",
    "Use ONLY after the user has stated a clear stance. NEVER silently",
    "default. RAISED is the most novel: it converts unspoken cognitive",
    "weight into a real exchange. When the user says 'I should bring it",
    "up' or 'I'll mention it next time we speak', that's a candidate for",
    "RAISED.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("kept"),
      owed_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("raised"),
      owed_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what you said when you brought it up) is required for raised").max(1500),
      raised_outcome: z.enum(["they_followed_through", "they_apologized", "they_explained", "they_dismissed_it", "no_response"]).optional(),
    }),
    z.object({
      mode: z.literal("broken"),
      owed_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what they said when they declined / what changed) is required for broken").max(1500),
    }),
    z.object({
      mode: z.literal("forgotten"),
      owed_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (your read on why this was forgotten and why you're letting it go) is required for forgotten").max(1500),
    }),
    z.object({
      mode: z.literal("released"),
      owed_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("dismiss"),
      owed_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      owed_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      owed_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      owed_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      owed_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      owed_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("reschedule"),
      owed_id: z.string().uuid(),
      days: z.number().int().min(1).max(365),
    }),
    z.object({
      mode: z.literal("edit"),
      owed_id: z.string().uuid(),
      promise_text: z.string().min(4).max(280).optional(),
      relationship_with: z.enum(["partner", "parent", "sibling", "friend", "colleague", "boss", "client", "stranger", "unknown"]).optional(),
      person_text: z.string().max(160).optional(),
      domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"]).optional(),
      charge: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "owed_id"],
    properties: {
      mode: { type: "string", enum: ["kept", "raised", "broken", "forgotten", "released", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "reschedule", "edit"] },
      owed_id: { type: "string" },
      resolution_note: { type: "string", description: "REQUIRED for raised (what you said when you brought it up), broken (what they said when they declined), forgotten (your read on why); optional for kept, released, dismiss." },
      raised_outcome: { type: "string", enum: ["they_followed_through", "they_apologized", "they_explained", "they_dismissed_it", "no_response"], description: "Optional secondary field for mode='raised' — what happened when you raised it." },
      days: { type: "number", description: "Required for reschedule (1-365)." },
      promise_text: { type: "string", description: "Optional for edit (4-280 chars)." },
      relationship_with: { type: "string", enum: ["partner", "parent", "sibling", "friend", "colleague", "boss", "client", "stranger", "unknown"], description: "Optional for edit." },
      person_text: { type: "string", description: "Optional for edit (≤160 chars; pass empty to clear)." },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"], description: "Optional for edit." },
      charge: { type: "number", description: "Optional for edit (1-5)." },
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
    if (input.mode === "raised") {
      body.resolution_note = input.resolution_note;
      if (input.raised_outcome) body.raised_outcome = input.raised_outcome;
    } else if (input.mode === "broken" || input.mode === "forgotten") {
      body.resolution_note = input.resolution_note;
    } else if (input.mode === "kept" || input.mode === "released" || input.mode === "dismiss") {
      if (input.resolution_note) body.resolution_note = input.resolution_note;
    } else if (input.mode === "reschedule") {
      body.days = input.days;
    } else if (input.mode === "edit") {
      if (input.promise_text) body.promise_text = input.promise_text;
      if (input.relationship_with) body.relationship_with = input.relationship_with;
      if (input.person_text !== undefined) body.person_text = input.person_text;
      if (input.domain) body.domain = input.domain;
      if (typeof input.charge === "number") body.charge = input.charge;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/owed-to-me/${input.owed_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { owed?: Owed };
    const p = j.owed;
    if (!p) return { ok: false, error: "no owed_to_me row returned" };
    return {
      ok: true,
      owed_id: p.id,
      status: p.status,
      resolution_note: p.resolution_note,
      raised_outcome: p.raised_outcome,
      pinned: p.pinned,
      archived_at: p.archived_at,
      promise_text: p.promise_text,
      relationship_with: p.relationship_with,
      person_text: p.person_text,
      target_date: p.target_date,
    };
  },
});
