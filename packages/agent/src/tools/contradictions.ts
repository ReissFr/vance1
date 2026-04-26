// Brain tools for THE CONTRADICTIONS LEDGER (§176) — pairs of statements
// across the chat history that contradict each other.
//
// Different mechanism from every utterance-extractor (§165–§175). Those
// tools mine for utterances of a particular SHAPE — "I used to", "I should",
// "I'll", "I always". This one does RELATIONAL extraction: finds PAIRS of
// statements that disagree across time.
//
// The novel hook is DUAL — a resolution stance that refuses the assumption
// that one of two contradicting statements must be wrong. Some
// contradictions are genuine duality: "I'm a private person" AND "I want
// to be known for my work" both hold, in different contexts, without
// either being false. Naming that converts "I'm inconsistent" into "I am
// multifaceted in this specific way".
//
// Four resolutions, refusing the binary of accept-or-deny:
//   evolved   — the later statement is now-true; the earlier was a past
//               self.
//   dual      — both hold in different contexts/moods/life-phases.
//   confused  — the user genuinely doesn't know which holds; held open.
//   rejected  — neither is current; the user has moved past both.
//
// DAYS_APART is the secondary novel signal — the longer the gap, the more
// the user is forced to reckon with whether they've genuinely changed or
// just told different stories at different times.

import { z } from "zod";
import { defineTool } from "./types";

type Contradiction = {
  id: string;
  scan_id: string | null;
  statement_a: string;
  statement_a_date: string;
  statement_a_msg_id: string;
  statement_b: string;
  statement_b_date: string;
  statement_b_msg_id: string;
  topic: string;
  contradiction_kind: string;
  domain: string;
  charge: number;
  confidence: number;
  days_apart: number;
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
  open: number;
  evolved: number;
  dual: number;
  confused: number;
  rejected: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  longest_unreconciled_days: number;
  avg_charge_open: number;
  by_status: Record<string, number>;
  by_kind: Record<string, number>;
  by_domain: Record<string, number>;
};

export const scanContradictionsTool = defineTool({
  name: "scan_contradictions",
  description: [
    "Mine the user's chat for CONTRADICTIONS — pairs of statements where",
    "the user said one thing on one date and a contradicting thing on",
    "another. Different mechanism from every other extractor: this one",
    "does RELATIONAL extraction, not single-utterance extraction. It finds",
    "PAIRS that disagree across time.",
    "",
    "For each pair captures: the earlier statement (statement_a) with its",
    "date/msg_id, the later statement (statement_b) with its date/msg_id,",
    "a TOPIC naming the territory of the inconsistency, a",
    "CONTRADICTION_KIND (preference / belief / claim / commitment /",
    "identity / value / desire / appraisal), a CHARGE 1-5 (how big), a",
    "DOMAIN, a CONFIDENCE. Server computes DAYS_APART authoritatively from",
    "the dates and rejects pairs <7 days apart (those are mood-of-the-",
    "moment, not contradiction).",
    "",
    "Costs an LLM call (15-30s). Default window 180 days. Min 30 days.",
    "Won't insert duplicates of pairs already in the ledger.",
    "",
    "Use when the user asks 'where do I contradict myself', 'where am I",
    "inconsistent', 'where do I say one thing and another', 'has my",
    "position changed', or as a meta-companion to any reflection scan.",
    "Quote the topic verbatim AND surface BOTH statements when reporting —",
    "the user needs to see the actual words to reckon with whether it's",
    "growth (evolved), duality (dual), confusion, or rejection of both.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(540).optional().default(180),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (30-540, default 180)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/contradictions/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 180 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `contradictions scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      skipped?: number;
      latency_ms?: number;
      message?: string;
      contradictions?: Contradiction[];
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
      contradictions: (j.contradictions ?? []).map((c) => ({
        id: c.id,
        topic: c.topic,
        kind: c.contradiction_kind,
        domain: c.domain,
        statement_a: c.statement_a,
        statement_a_date: c.statement_a_date,
        statement_b: c.statement_b,
        statement_b_date: c.statement_b_date,
        days_apart: c.days_apart,
        charge: c.charge,
        confidence: c.confidence,
      })),
    };
  },
});

export const listContradictionsTool = defineTool({
  name: "list_contradictions",
  description: [
    "List contradictions in the user's ledger plus stats. Filters:",
    "  status           (open | evolved | dual | confused | rejected |",
    "                    dismissed | archived | all, default open)",
    "  kind             (preference | belief | claim | commitment |",
    "                    identity | value | desire | appraisal | all)",
    "  domain           (work | health | relationships | family | finance",
    "                    | creative | self | spiritual | other | all)",
    "  min_charge       (1-5, default 1)",
    "  min_days_apart   (default 0)",
    "  pinned           (true to filter pinned only)",
    "  limit            (default 30, max 200)",
    "",
    "Returns contradictions + stats including load_bearing_open (open",
    "contradictions with charge=5 — identity-level inconsistencies),",
    "longest_unreconciled_days (THE diagnostic — the contradiction that",
    "has stood longest), avg_charge_open, by_status / by_kind / by_domain",
    "buckets, dual count (the novel resolution count).",
    "",
    "Use when the user asks 'where do I contradict myself', 'what's",
    "inconsistent in me', 'where have I changed my mind', 'have I drifted'",
    "or 'where am I conflicted'. ALWAYS surface both statement_a and",
    "statement_b verbatim AND name DAYS_APART — the gap is the operative",
    "fact. A 7-day contradiction is mood; a 700-day contradiction is",
    "becoming. Honour the DUAL resolution as the most novel — refusing the",
    "binary of accept-or-deny is often the right move.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "evolved", "dual", "confused", "rejected", "dismissed", "archived", "all"]).optional().default("open"),
    kind: z.enum(["preference", "belief", "claim", "commitment", "identity", "value", "desire", "appraisal", "all"]).optional().default("all"),
    domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"]).optional().default("all"),
    min_charge: z.number().int().min(1).max(5).optional().default(1),
    min_days_apart: z.number().int().min(0).max(3650).optional().default(0),
    pinned: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "evolved", "dual", "confused", "rejected", "dismissed", "archived", "all"] },
      kind: { type: "string", enum: ["preference", "belief", "claim", "commitment", "identity", "value", "desire", "appraisal", "all"] },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"] },
      min_charge: { type: "number" },
      min_days_apart: { type: "number" },
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
    if (status === "archived") {
      params.set("include_archived", "true");
      params.set("status", "archived");
    } else if (status === "all") {
      params.set("include_archived", "true");
    } else {
      params.set("status", status);
    }
    if (input.kind && input.kind !== "all") params.set("kind", input.kind);
    if (input.domain && input.domain !== "all") params.set("domain", input.domain);
    if (input.min_charge && input.min_charge > 1) params.set("min_charge", String(input.min_charge));
    if (input.min_days_apart && input.min_days_apart > 0) params.set("min_days_apart", String(input.min_days_apart));
    if (input.pinned) params.set("pinned", "true");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/contradictions?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { contradictions?: Contradiction[]; stats?: Stats };
    const rows = j.contradictions ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      contradictions: rows.map((c) => ({
        id: c.id,
        topic: c.topic,
        kind: c.contradiction_kind,
        domain: c.domain,
        statement_a: c.statement_a,
        statement_a_date: c.statement_a_date,
        statement_b: c.statement_b,
        statement_b_date: c.statement_b_date,
        days_apart: c.days_apart,
        charge: c.charge,
        confidence: c.confidence,
        status: c.status,
        resolution_note: c.resolution_note,
        pinned: c.pinned,
      })),
    };
  },
});

export const respondToContradictionTool = defineTool({
  name: "respond_to_contradiction",
  description: [
    "Resolve, edit, or annotate a contradiction. Specify exactly one mode:",
    "",
    "  evolved  — the LATER statement is now-true; the earlier was a past",
    "             self. resolution_note IS which statement is current and",
    "             what changed (REQUIRED — server rejects empty). Use when",
    "             the user has genuinely changed and the older statement",
    "             is historical. Examples:",
    "               'whether I want to live in London' -> evolved with",
    "               note 'the later one. After last year I know I need to",
    "               leave.'",
    "",
    "  dual    — BOTH statements hold in different contexts / moods /",
    "             life-phases. THE NOVEL RESOLUTION — refuses the",
    "             assumption that one must be wrong. resolution_note IS",
    "             how each one holds (REQUIRED). Use when the user",
    "             recognises both as true. Examples:",
    "               'how visible I want to be' -> dual with note 'I AM a",
    "               private person about my inner life and I DO want my",
    "               work to be known. They're different territories, not",
    "               a contradiction.'",
    "",
    "  confused  — the user genuinely doesn't know which holds. The",
    "              contradiction is alive and unreconciled.",
    "              resolution_note IS what makes this hard (REQUIRED).",
    "              Use when neither is yet right. The contradiction is",
    "              honoured as a live unanswered question. Examples:",
    "                'whether I want kids' -> confused with note 'I move",
    "                between yes and no every few months. I haven't",
    "                landed.'",
    "",
    "  rejected  — neither statement is current; the user has moved past",
    "              both. resolution_note IS the actual current stance",
    "              (REQUIRED). Use when both old positions feel wrong now.",
    "              Examples:",
    "                'whether money matters' -> rejected with note 'both",
    "                were performances. The truth is enough money to be",
    "                free, then it stops mattering.'",
    "",
    "  dismiss   — false positive from the scan (the two statements don't",
    "              actually contradict).",
    "  unresolve — return to open.",
    "  pin / unpin — toggle pinned.",
    "  archive / restore — soft hide / un-hide.",
    "  edit      — fix mis-extracted statement_a / statement_b / topic.",
    "              ≥1 required.",
    "",
    "Use ONLY after the user has stated a clear stance. NEVER silently",
    "default — make the user pick between evolved / dual / confused /",
    "rejected. The four resolutions hold open four different futures for",
    "the contradiction. DUAL is the most novel: it converts 'I'm",
    "inconsistent' into 'I am multifaceted in this specific way'.",
  ].join("\n"),
  schema: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("evolved"),
      contradiction_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (which is now current and what changed) is required for evolved").max(1500),
    }),
    z.object({
      action: z.literal("dual"),
      contradiction_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (in what contexts each statement holds) is required for dual").max(1500),
    }),
    z.object({
      action: z.literal("confused"),
      contradiction_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what makes this hard to reconcile) is required for confused").max(1500),
    }),
    z.object({
      action: z.literal("rejected"),
      contradiction_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (the actual current stance) is required for rejected").max(1500),
    }),
    z.object({
      action: z.literal("dismiss"),
      contradiction_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      action: z.literal("unresolve"),
      contradiction_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("pin"),
      contradiction_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("unpin"),
      contradiction_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("archive"),
      contradiction_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("restore"),
      contradiction_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("edit"),
      contradiction_id: z.string().uuid(),
      statement_a: z.string().min(4).max(400).optional(),
      statement_b: z.string().min(4).max(400).optional(),
      topic: z.string().min(4).max(120).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["action", "contradiction_id"],
    properties: {
      action: { type: "string", enum: ["evolved", "dual", "confused", "rejected", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      contradiction_id: { type: "string" },
      resolution_note: { type: "string", description: "REQUIRED for evolved (which is now current and what changed), dual (in what contexts each holds), confused (what makes this hard), rejected (the actual current stance); optional for dismiss." },
      statement_a: { type: "string", description: "Optional for edit — replacement earlier statement (4-400 chars)." },
      statement_b: { type: "string", description: "Optional for edit — replacement later statement (4-400 chars)." },
      topic: { type: "string", description: "Optional for edit — replacement topic phrase (4-120 chars)." },
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
    if (input.action === "evolved" || input.action === "dual" || input.action === "confused" || input.action === "rejected") {
      body.resolution_note = input.resolution_note;
    } else if (input.action === "dismiss") {
      if (input.resolution_note) body.resolution_note = input.resolution_note;
    } else if (input.action === "edit") {
      if (input.statement_a) body.statement_a = input.statement_a;
      if (input.statement_b) body.statement_b = input.statement_b;
      if (input.topic) body.topic = input.topic;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/contradictions/${input.contradiction_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { contradiction?: Contradiction };
    const c = j.contradiction;
    if (!c) return { ok: false, error: "no contradiction returned" };
    return {
      ok: true,
      contradiction_id: c.id,
      status: c.status,
      resolution_note: c.resolution_note,
      pinned: c.pinned,
      archived_at: c.archived_at,
      topic: c.topic,
      statement_a: c.statement_a,
      statement_b: c.statement_b,
      days_apart: c.days_apart,
    };
  },
});
