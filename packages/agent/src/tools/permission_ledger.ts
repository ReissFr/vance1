// Brain tools for the PERMISSION LEDGER — moments the user sought
// authorisation for something they shouldn't actually need permission for.
// Five kinds: explicit_permission / justification / self_doubt /
// comparison_to_norm / future_excuse. Each seeking records WHAT they were
// asking permission for (requested_action), WHO they imagined might
// disapprove (implicit_authority — self_judge / partner / parent /
// professional_norm / social_norm / friend / work_authority /
// financial_judge / abstract_other), the urgency_score (1-5 how charged),
// and pattern_severity which captures recurrence + chronic-shape as a
// single score.

import { z } from "zod";
import { defineTool } from "./types";

type RecurrenceSample = { date: string; snippet: string };

type Seeking = {
  id: string;
  scan_id: string;
  request_text: string;
  request_kind: string;
  requested_action: string;
  action_aliases: string[];
  implicit_authority: string;
  urgency_score: number;
  domain: string;
  spoken_date: string;
  spoken_message_id: string | null;
  spoken_conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_samples: RecurrenceSample[];
  pattern_severity: number;
  confidence: number;
  status: string;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type ActionCount = { action: string; recurrence: number; chronic_rows: number; authorities: string[] };
type AuthorityCount = { authority: string; rows: number; chronic_rows: number; total_recurrence: number };

type Stats = {
  total: number;
  pending: number;
  acknowledged: number;
  contested: number;
  granted: number;
  dismissed: number;
  chronic_seeking: number;
  high_urgency: number;
  kind_counts: Record<string, number>;
  authority_counts: AuthorityCount[];
  domain_counts: Record<string, number>;
  action_counts: ActionCount[];
};

export const scanPermissionLedgerTool = defineTool({
  name: "scan_permission_ledger",
  description: [
    "Run a PERMISSION LEDGER SCAN — mine the user's own messages for",
    "moments they sought authorisation for something they shouldn't",
    "actually need permission for. Five kinds:",
    "  explicit_permission  — 'is it ok if I take a day off'",
    "  justification        — 'I should be allowed to', 'I shouldn't but'",
    "  self_doubt           — 'is it bad that I want', 'is it selfish to'",
    "  comparison_to_norm   — 'do most people do this', 'is this normal'",
    "  future_excuse        — 'I'm probably going to skip the gym but'",
    "",
    "For each the server records WHAT they were asking permission FOR",
    "(requested_action — 1-5 word verb-led phrase like 'take a day off',",
    "'skip the meeting', 'say no to my dad'), WHO they imagined might",
    "disapprove (implicit_authority: self_judge / partner / parent /",
    "professional_norm / social_norm / friend / work_authority /",
    "financial_judge / abstract_other), and the URGENCY (1-5).",
    "",
    "Phase 2 walks subsequent messages for the same action and aliases,",
    "counting recurrence_count + recurrence_days + co-seeking shape.",
    "pattern_severity:",
    "  5 = recurrence >=10 + multiple co-seekings about same action",
    "  4 = recurrence >=6 + same shape",
    "  3 = recurrence >=3 + urgency >=4",
    "  2 = recurrence >=3 mixed",
    "  1 = isolated",
    "",
    "Use when the user asks 'is it ok if', 'am I allowed to', 'is it bad",
    "that I', 'do most people', 'should I feel guilty about', 'I",
    "shouldn't but', 'is it weird/selfish/wrong to', 'will my [partner|",
    "boss|mum] hate me if', 'is this normal'. Different from the mirror",
    "index (self-comparisons) — the ledger catches authorisation-seeking,",
    "where the user has externalised authority over their own choices.",
    "",
    "Optional: window_days (30-365, default 120). Costs an LLM call",
    "plus a substring scan (10-25s).",
    "",
    "The brain should run this when the user is in permission-seeking",
    "mode — surfacing 'you've asked permission for X 14 times in 90",
    "days, all to your business' is the load-bearing pattern.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/permission-ledger/scan`, {
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
      seekings?: Seeking[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      seekings: (j.seekings ?? []).map((c) => ({
        id: c.id,
        request_kind: c.request_kind,
        requested_action: c.requested_action,
        implicit_authority: c.implicit_authority,
        urgency_score: c.urgency_score,
        domain: c.domain,
        spoken_date: c.spoken_date,
        recurrence_count: c.recurrence_count,
        recurrence_days: c.recurrence_days,
        pattern_severity: c.pattern_severity,
        confidence: c.confidence,
      })),
    };
  },
});

export const listPermissionLedgerTool = defineTool({
  name: "list_permission_ledger",
  description: [
    "List mined permission-seekings plus stats. Optional filters:",
    "  status    (pending | acknowledged | contested | granted |",
    "             dismissed | pinned | archived | all, default pending)",
    "  kind      (explicit_permission | justification | self_doubt |",
    "             comparison_to_norm | future_excuse | all, default all)",
    "  authority (self_judge | partner | parent | professional_norm |",
    "             social_norm | friend | work_authority |",
    "             financial_judge | abstract_other | all, default all)",
    "  domain    (work | relationships | health | identity | finance |",
    "             creative | learning | daily | other | all, default all)",
    "  min_severity   (1-5, default 1)",
    "  min_confidence (1-5, default 2)",
    "  min_urgency    (1-5, default 1)",
    "  limit          (default 30, max 100)",
    "",
    "Returns rows + stats including chronic_seeking (severity>=4),",
    "high_urgency (urgency>=4), per-kind / per-domain counts,",
    "authority_counts (sorted by total_recurrence — WHO the user defers",
    "to most), AND action_counts — top 8 chronic actions by recurrence.",
    "",
    "The action_counts and authority_counts lists are the load-bearing",
    "findings: 'you keep asking permission to take a day off — 14 times,",
    "always to your business' is the structural diagnostic. Quote them",
    "directly when surfacing patterns.",
    "",
    "Use cases:",
    "  - 'who do I keep asking permission from' -> stats.authority_counts.",
    "  - 'what am I asking permission for repeatedly' -> stats.action_counts.",
    "  - 'where am I deferring to my business' -> filter authority=work_authority.",
    "  - 'where am I seeking permission from my partner' -> authority=partner.",
    "  - 'what self-permissions have I granted' -> filter status=granted.",
    "",
    "When surfacing a row, quote requested_action verbatim AND the",
    "verbatim request_text. Don't paraphrase the seeking.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "acknowledged", "contested", "granted", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    kind: z.enum(["explicit_permission", "justification", "self_doubt", "comparison_to_norm", "future_excuse", "all"]).optional().default("all"),
    authority: z.enum(["self_judge", "partner", "parent", "professional_norm", "social_norm", "friend", "work_authority", "financial_judge", "abstract_other", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_severity: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    min_urgency: z.number().int().min(1).max(5).optional().default(1),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "acknowledged", "contested", "granted", "dismissed", "pinned", "archived", "all"] },
      kind: { type: "string", enum: ["explicit_permission", "justification", "self_doubt", "comparison_to_norm", "future_excuse", "all"] },
      authority: { type: "string", enum: ["self_judge", "partner", "parent", "professional_norm", "social_norm", "friend", "work_authority", "financial_judge", "abstract_other", "all"] },
      domain: { type: "string", enum: ["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"] },
      min_severity: { type: "number" },
      min_confidence: { type: "number" },
      min_urgency: { type: "number" },
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
    params.set("kind", input.kind ?? "all");
    params.set("authority", input.authority ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_severity", String(Math.max(1, Math.min(5, input.min_severity ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("min_urgency", String(Math.max(1, Math.min(5, input.min_urgency ?? 1))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/permission-ledger?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { seekings?: Seeking[]; stats?: Stats };
    const rows = j.seekings ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      seekings: rows.map((c) => ({
        id: c.id,
        request_text: c.request_text,
        request_kind: c.request_kind,
        requested_action: c.requested_action,
        implicit_authority: c.implicit_authority,
        urgency_score: c.urgency_score,
        domain: c.domain,
        spoken_date: c.spoken_date,
        recurrence_count: c.recurrence_count,
        recurrence_days: c.recurrence_days,
        recurrence_samples: (c.recurrence_samples ?? []).slice(0, 3),
        pattern_severity: c.pattern_severity,
        confidence: c.confidence,
        status: c.status,
        status_note: c.status_note,
        pinned: c.pinned,
      })),
    };
  },
});

export const respondToPermissionSeekingTool = defineTool({
  name: "respond_to_permission_seeking",
  description: [
    "Resolve or annotate a mined permission-seeking. Specify exactly one mode:",
    "",
    "  grant        — user is granting themselves permission NOW.",
    "                 status_note IS the self-permission grant text",
    "                 (REQUIRED — server rejects empty notes for this",
    "                 mode). Locks the seeking to status='granted'.",
    "                 Example status_note: 'I am allowed to take a day",
    "                 off. I do not need permission for this from my",
    "                 business.' Must be in user's own words.",
    "  acknowledged — user acknowledges the pattern but isn't granting",
    "                 yet. Optional status_note.",
    "  contested    — user disagrees this was permission-seeking (false",
    "                 positive). status_note explains why.",
    "  dismissed    — junk extraction / not relevant.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use 'grant' when the user offers a self-permission statement —",
    "capture their words verbatim, don't fabricate a grant on their",
    "behalf. A good grant names the action AND addresses the imagined",
    "authority directly ('I don't need my partner's permission to').",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["grant", "acknowledged", "contested", "dismissed", "pin", "unpin", "archive", "restore"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["grant", "acknowledged", "contested", "dismissed", "pin", "unpin", "archive", "restore"] },
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
    if (input.mode === "grant") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "grant mode requires status_note (the user's actual self-permission grant)" };
      }
      payload.status = "granted";
      payload.status_note = input.status_note;
    } else if (["acknowledged", "contested", "dismissed"].includes(input.mode)) {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/permission-ledger/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { seeking?: Seeking };
    if (!j.seeking) return { ok: false, error: "no row returned" };
    const c = j.seeking;
    return {
      ok: true,
      seeking: {
        id: c.id,
        request_text: c.request_text,
        request_kind: c.request_kind,
        requested_action: c.requested_action,
        implicit_authority: c.implicit_authority,
        urgency_score: c.urgency_score,
        status: c.status,
        status_note: c.status_note,
        pinned: c.pinned,
        archived: c.archived_at != null,
      },
    };
  },
});
