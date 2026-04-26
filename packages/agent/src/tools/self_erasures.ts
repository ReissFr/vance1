// Brain tools for the SELF-ERASURE REGISTER — moments the user OVERRULED
// their own thought mid-stream. Five kinds: self_dismissal / cancellation /
// self_pathologising / minimisation / truncation. Each erasure records the
// erasure phrase verbatim, the THOUGHT that was cancelled (what_was_erased
// + what_was_erased_kind), the inferred internal voice that did the
// cancelling (censor_voice), and pattern_severity which captures
// recurrence + chronic-shape as a single score.

import { z } from "zod";
import { defineTool } from "./types";

type RecurrenceSample = { date: string; snippet: string };

type Erasure = {
  id: string;
  scan_id: string;
  erasure_text: string;
  erasure_kind: string;
  what_was_erased: string | null;
  what_was_erased_kind: string | null;
  censor_voice: string | null;
  domain: string;
  spoken_date: string;
  spoken_message_id: string | null;
  spoken_conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_with_target: number;
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

type VoiceCount = { voice: string; rows: number; chronic_rows: number; total_recurrence: number };
type TargetCount = { target: string; rows: number; chronic_rows: number; total_recurrence: number };

type Stats = {
  total: number;
  pending: number;
  restored: number;
  released: number;
  noted: number;
  dismissed: number;
  reflex_erasure: number;
  pathologising: number;
  cancelled_feelings: number;
  cancelled_needs: number;
  kind_counts: Record<string, number>;
  target_counts: TargetCount[];
  voice_counts: VoiceCount[];
  domain_counts: Record<string, number>;
};

export const scanSelfErasuresTool = defineTool({
  name: "scan_self_erasures",
  description: [
    "Run a SELF-ERASURE REGISTER SCAN — mine the user's own messages for",
    "moments they OVERRULED their own thought mid-stream. The second",
    "voice cancelling the first. Five kinds:",
    "  self_dismissal      — 'ignore me', 'forget I said anything'",
    "  cancellation        — 'never mind', 'scratch that', 'nvm'",
    "  self_pathologising  — 'I'm being silly/dramatic/needy',",
    "                        'I'm overthinking', 'sorry for venting'",
    "  minimisation        — 'probably nothing', 'doesn't matter',",
    "                        'small thing but'",
    "  truncation          — 'I was going to say...', 'I almost said',",
    "                        'on second thought'",
    "",
    "For each the server records the erasure_text VERBATIM, the THOUGHT",
    "that was cancelled (what_was_erased + what_was_erased_kind: feeling /",
    "need / observation / request / opinion / memory / idea / complaint /",
    "unknown), and the inferred censor_voice — a 2-5 word internal voice",
    "(e.g. 'the don't-be-a-burden voice', 'the keep-it-light voice',",
    "'the editor', 'the calm-it-down voice'). The voice naming is the",
    "load-bearing diagnostic — surfacing 'the don't-be-a-burden voice'",
    "as the recurring censor across 8 cancelled needs is the pattern no",
    "other system names.",
    "",
    "Phase 2 walks subsequent messages for the same erasure shape,",
    "counting recurrence_count + recurrence_days + recurrence_with_target",
    "(how many of those recurrences ALSO had real content erased — not",
    "just verbal tic). pattern_severity:",
    "  5 = recurrence >=12 + recurrence_with_target >=5 — reflex self-cancellation",
    "  4 = recurrence >=8 + recurrence_with_target >=3 — entrenched censor",
    "  3 = recurrence >=4 + kind in (self_pathologising, self_dismissal)",
    "  2 = recurrence >=3 mixed",
    "  1 = isolated erasure",
    "",
    "Use when the user types 'never mind', 'forget it', 'I'm being silly',",
    "'probably nothing', 'ignore me', 'sorry for venting', 'I was going",
    "to say...', 'doesn't matter', 'I'm overthinking'. Different from the",
    "permission ledger (asking permission BEFORE action) — this catches",
    "self-cancellation AFTER the thought has already begun.",
    "",
    "Optional: window_days (30-365, default 120). Costs an LLM call",
    "plus a substring scan (10-25s).",
    "",
    "The brain should run this when the user is in self-cancelling mode.",
    "Surfacing 'you've cancelled feelings 12 times in 90 days, always",
    "with the don't-be-a-burden voice' is the structural finding.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/self-erasures/scan`, {
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
      erasures?: Erasure[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      erasures: (j.erasures ?? []).map((c) => ({
        id: c.id,
        erasure_kind: c.erasure_kind,
        what_was_erased_kind: c.what_was_erased_kind,
        censor_voice: c.censor_voice,
        domain: c.domain,
        spoken_date: c.spoken_date,
        recurrence_count: c.recurrence_count,
        recurrence_days: c.recurrence_days,
        recurrence_with_target: c.recurrence_with_target,
        pattern_severity: c.pattern_severity,
        confidence: c.confidence,
      })),
    };
  },
});

export const listSelfErasuresTool = defineTool({
  name: "list_self_erasures",
  description: [
    "List mined self-erasures plus stats. Optional filters:",
    "  status   (pending | restored | released | noted | dismissed |",
    "            pinned | archived | all, default pending)",
    "  kind     (self_dismissal | cancellation | self_pathologising |",
    "            minimisation | truncation | all, default all)",
    "  target   (feeling | need | observation | request | opinion |",
    "            memory | idea | complaint | unknown | all, default all)",
    "  domain   (work | relationships | health | identity | finance |",
    "            creative | learning | daily | other | all, default all)",
    "  min_severity   (1-5, default 1)",
    "  min_confidence (1-5, default 2)",
    "  limit          (default 30, max 100)",
    "",
    "Returns rows + stats including reflex_erasure (severity>=4),",
    "pathologising count, cancelled_feelings, cancelled_needs, per-kind",
    "/ per-domain counts, target_counts (sorted by total_recurrence —",
    "WHAT gets cancelled most: feelings, needs, requests), AND",
    "voice_counts — top 10 censor voices the user keeps overruling",
    "themselves with.",
    "",
    "The voice_counts and target_counts are the load-bearing diagnostic.",
    "'You keep overriding feelings with the don't-be-a-burden voice — 11",
    "times in 90 days' is the structural finding. Quote the censor_voice",
    "AND the verbatim what_was_erased when surfacing rows.",
    "",
    "Use cases:",
    "  - 'who keeps cancelling my thoughts' -> stats.voice_counts.",
    "  - 'what do I keep cancelling' -> stats.target_counts.",
    "  - 'when do I cancel my needs' -> filter target=need.",
    "  - 'when do I cancel my feelings' -> filter target=feeling.",
    "  - 'when do I pathologise myself' -> filter kind=self_pathologising.",
    "  - 'what thoughts have I restored' -> filter status=restored.",
    "",
    "When surfacing a row, quote what_was_erased verbatim AND the",
    "erasure_text and censor_voice. Don't paraphrase the cancellation.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "restored", "released", "noted", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    kind: z.enum(["self_dismissal", "cancellation", "self_pathologising", "minimisation", "truncation", "all"]).optional().default("all"),
    target: z.enum(["feeling", "need", "observation", "request", "opinion", "memory", "idea", "complaint", "unknown", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_severity: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "restored", "released", "noted", "dismissed", "pinned", "archived", "all"] },
      kind: { type: "string", enum: ["self_dismissal", "cancellation", "self_pathologising", "minimisation", "truncation", "all"] },
      target: { type: "string", enum: ["feeling", "need", "observation", "request", "opinion", "memory", "idea", "complaint", "unknown", "all"] },
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
    params.set("target", input.target ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_severity", String(Math.max(1, Math.min(5, input.min_severity ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/self-erasures?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { erasures?: Erasure[]; stats?: Stats };
    const rows = j.erasures ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      erasures: rows.map((c) => ({
        id: c.id,
        erasure_text: c.erasure_text,
        erasure_kind: c.erasure_kind,
        what_was_erased: c.what_was_erased,
        what_was_erased_kind: c.what_was_erased_kind,
        censor_voice: c.censor_voice,
        domain: c.domain,
        spoken_date: c.spoken_date,
        recurrence_count: c.recurrence_count,
        recurrence_days: c.recurrence_days,
        recurrence_with_target: c.recurrence_with_target,
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

export const respondToSelfErasureTool = defineTool({
  name: "respond_to_self_erasure",
  description: [
    "Resolve or annotate a mined self-erasure. Specify exactly one mode:",
    "",
    "  restore     — user is RESTORING the cancelled thought NOW.",
    "                status_note IS the restored thought — what they",
    "                actually wanted to say before the censor stepped in",
    "                (REQUIRED — server rejects empty notes for this",
    "                mode). Locks the row to status='restored'.",
    "                Example status_note: 'I was actually exhausted and",
    "                wanted to ask you to take over the school run, but",
    "                I felt like a burden so I cancelled it'. Must be in",
    "                user's own words — don't fabricate the restoration.",
    "  released    — user explicitly chooses to keep the erasure (some",
    "                erasures are wise edits, not censorship). Optional",
    "                status_note explains why.",
    "  noted       — acknowledged but neither restored nor released.",
    "                Optional status_note.",
    "  dismissed   — false positive / not actually a self-erasure.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use 'restore' when the user offers what they actually wanted to",
    "say — capture their words verbatim. A good restoration names the",
    "feeling/need/request that was being cancelled and the reason it",
    "was cancelled ('I felt like a burden').",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["restore", "released", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["restore", "released", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"] },
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
    if (input.mode === "restore") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "restore mode requires status_note (the user's actual restored thought)" };
      }
      payload.status = "restored";
      payload.status_note = input.status_note;
    } else if (["released", "noted", "dismissed"].includes(input.mode)) {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "unarchive") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/self-erasures/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { erasure?: Erasure };
    if (!j.erasure) return { ok: false, error: "no row returned" };
    const c = j.erasure;
    return {
      ok: true,
      erasure: {
        id: c.id,
        erasure_text: c.erasure_text,
        erasure_kind: c.erasure_kind,
        what_was_erased: c.what_was_erased,
        what_was_erased_kind: c.what_was_erased_kind,
        censor_voice: c.censor_voice,
        status: c.status,
        status_note: c.status_note,
        pinned: c.pinned,
        archived: c.archived_at != null,
      },
    };
  },
});
