// Brain tools for the MIRROR INDEX — moments the user compared themselves to
// someone or something. Six kinds: past_self / peer / sibling_or_parent /
// ideal_self / imagined_future_self / downward. Each comparison records
// who/what they measured against (target), where they put themselves
// (below/equal/above/aspiring), the fairness of the comparison (1-5), the
// valence (lifting/neutral/punishing), and pattern_severity which captures
// recurrence + below-position + unfairness as a single score.

import { z } from "zod";
import { defineTool } from "./types";

type RecurrenceSample = { date: string; snippet: string };

type Comparison = {
  id: string;
  scan_id: string;
  comparison_text: string;
  comparison_kind: string;
  comparison_target: string;
  target_aliases: string[];
  self_position: string;
  fairness_score: number;
  valence: string;
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

type TargetCount = { target: string; recurrence: number; punishing_rows: number };

type Stats = {
  total: number;
  pending: number;
  acknowledged: number;
  contested: number;
  reframed: number;
  dismissed: number;
  severely_punishing: number;
  chronic_unfair: number;
  kind_counts: Record<string, number>;
  position_counts: Record<string, number>;
  valence_counts: Record<string, number>;
  domain_counts: Record<string, number>;
  target_counts: TargetCount[];
};

export const scanMirrorIndexTool = defineTool({
  name: "scan_mirror_index",
  description: [
    "Run a MIRROR INDEX SCAN — mine the user's own messages for moments",
    "they compared themselves to someone or something. Six kinds:",
    "  past_self            — 'when I was 25 I would have', 'old me'",
    "  peer                 — 'X has a startup and 3 kids', 'everyone else'",
    "  sibling_or_parent    — 'my brother built X by 30', 'my dad would'",
    "  ideal_self           — 'I should be the kind of person who'",
    "  imagined_future_self — 'I want to be the kind of person who'",
    "  downward             — 'at least I'm not', 'imagine being them'",
    "",
    "For each comparison the server records WHO/WHAT they measured against",
    "(target — 1-5 word noun phrase like 'my brother', 'old me at 23',",
    "'founders my age'), WHERE they placed themselves (below/equal/above/",
    "aspiring), the FAIRNESS of the comparison (1-5, where 1 = cruel/",
    "distorted, 5 = fair/honest accounting that acknowledges starting points",
    "and luck), and the VALENCE (lifting/neutral/punishing).",
    "",
    "Phase 2 walks subsequent messages for the same target and aliases,",
    "counting recurrence_count + recurrence_days. pattern_severity:",
    "  5 = recurrence >=10 + below + (punishing OR fairness <=2)",
    "  4 = recurrence >=6 + same shape",
    "  3 = recurrence >=3 + punishing",
    "  2 = recurrence >=3 mixed",
    "  1 = isolated",
    "",
    "Use when the user says they're 'feeling behind', 'feeling like a",
    "failure', 'comparing themselves', 'wondering why X has it together",
    "and I don't', 'thinking about my brother / dad / friend', 'old me",
    "would have'. Different from the question graveyard (unanswered",
    "self-questions) — the mirror catches measuring-stick moments.",
    "",
    "Optional: window_days (30-365, default 120). Costs an LLM call",
    "plus a substring scan (10-25s).",
    "",
    "The brain should run this when the user is in self-comparison mode,",
    "or when surfacing a chronic punishing target (like 'my brother x14",
    "always below, fairness <=2') could unblock them.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/mirror-index/scan`, {
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
      comparisons?: Comparison[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      comparisons: (j.comparisons ?? []).map((c) => ({
        id: c.id,
        comparison_kind: c.comparison_kind,
        comparison_target: c.comparison_target,
        self_position: c.self_position,
        fairness_score: c.fairness_score,
        valence: c.valence,
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

export const listMirrorIndexTool = defineTool({
  name: "list_mirror_index",
  description: [
    "List mined comparisons plus stats. Optional filters:",
    "  status   (pending | acknowledged | contested | reframed |",
    "            dismissed | pinned | archived | all, default pending)",
    "  kind     (past_self | peer | sibling_or_parent | ideal_self |",
    "            imagined_future_self | downward | all, default all)",
    "  position (below | equal | above | aspiring | all, default all)",
    "  valence  (lifting | neutral | punishing | all, default all)",
    "  domain   (work | relationships | health | identity | finance |",
    "            creative | learning | daily | other | all, default all)",
    "  min_severity   (1-5, default 1)",
    "  min_confidence (1-5, default 2)",
    "  limit          (default 30, max 100)",
    "",
    "Returns rows + stats including severely_punishing (severity>=4 AND",
    "valence=punishing AND position=below), chronic_unfair (severity>=4",
    "AND fairness<=2), per-kind / per-position / per-valence / per-domain",
    "counts, AND target_counts — top 8 chronic targets by recurrence.",
    "",
    "The target_counts list is the load-bearing finding: it surfaces WHO",
    "the user keeps measuring themselves against. 'my brother x14, of",
    "which 9 punishing' is more diagnostic than any single comparison.",
    "Quote target_counts directly to the user when they ask 'what",
    "patterns are showing up'.",
    "",
    "Use cases:",
    "  - 'who do I keep comparing myself to' -> stats.target_counts.",
    "  - 'what comparisons are punishing me' -> filter valence=punishing,",
    "    position=below, sorted by pattern_severity desc.",
    "  - 'where am I being unfair to myself' -> the rows where",
    "    fairness_score is 1 or 2 are by definition cruel comparisons.",
    "  - 'what reframes have I written' -> filter status=reframed.",
    "",
    "When surfacing a row, quote comparison_target verbatim AND the",
    "verbatim comparison_text. The point is to put the comparison in",
    "front of the user, not paraphrase it.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "acknowledged", "contested", "reframed", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    kind: z.enum(["past_self", "peer", "sibling_or_parent", "ideal_self", "imagined_future_self", "downward", "all"]).optional().default("all"),
    position: z.enum(["below", "equal", "above", "aspiring", "all"]).optional().default("all"),
    valence: z.enum(["lifting", "neutral", "punishing", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_severity: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "acknowledged", "contested", "reframed", "dismissed", "pinned", "archived", "all"] },
      kind: { type: "string", enum: ["past_self", "peer", "sibling_or_parent", "ideal_self", "imagined_future_self", "downward", "all"] },
      position: { type: "string", enum: ["below", "equal", "above", "aspiring", "all"] },
      valence: { type: "string", enum: ["lifting", "neutral", "punishing", "all"] },
      domain: { type: "string", enum: ["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"] },
      min_severity: { type: "number" },
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
    params.set("kind", input.kind ?? "all");
    params.set("position", input.position ?? "all");
    params.set("valence", input.valence ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_severity", String(Math.max(1, Math.min(5, input.min_severity ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/mirror-index?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { comparisons?: Comparison[]; stats?: Stats };
    const rows = j.comparisons ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      comparisons: rows.map((c) => ({
        id: c.id,
        comparison_text: c.comparison_text,
        comparison_kind: c.comparison_kind,
        comparison_target: c.comparison_target,
        self_position: c.self_position,
        fairness_score: c.fairness_score,
        valence: c.valence,
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

export const respondToComparisonTool = defineTool({
  name: "respond_to_comparison",
  description: [
    "Resolve or annotate a mined comparison. Specify exactly one mode:",
    "",
    "  reframe      — user is writing a fair, lifting reframe of the",
    "                 comparison NOW. status_note IS the reframe text",
    "                 (REQUIRED — server rejects empty notes for this",
    "                 mode). Locks the comparison to status='reframed'.",
    "  acknowledged — user acknowledges the pattern but isn't reframing",
    "                 yet. Optional status_note.",
    "  contested    — user disagrees this was a real comparison (false",
    "                 positive). status_note explains why.",
    "  dismissed    — junk extraction / not relevant.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use 'reframe' when the user offers a fair accounting of the",
    "comparison — capture their words, don't fabricate a reframe on",
    "their behalf. A good reframe acknowledges differences in starting",
    "points, timing, luck, or what they can't see from outside.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["reframe", "acknowledged", "contested", "dismissed", "pin", "unpin", "archive", "restore"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["reframe", "acknowledged", "contested", "dismissed", "pin", "unpin", "archive", "restore"] },
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
    if (input.mode === "reframe") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "reframe mode requires status_note (the user's actual reframe)" };
      }
      payload.status = "reframed";
      payload.status_note = input.status_note;
    } else if (["acknowledged", "contested", "dismissed"].includes(input.mode)) {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/mirror-index/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { comparison?: Comparison };
    if (!j.comparison) return { ok: false, error: "no row returned" };
    const c = j.comparison;
    return {
      ok: true,
      comparison: {
        id: c.id,
        comparison_text: c.comparison_text,
        comparison_kind: c.comparison_kind,
        comparison_target: c.comparison_target,
        self_position: c.self_position,
        fairness_score: c.fairness_score,
        valence: c.valence,
        status: c.status,
        status_note: c.status_note,
        pinned: c.pinned,
        archived: c.archived_at != null,
      },
    };
  },
});
