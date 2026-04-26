// Brain tools for THE LOOPS REGISTER (§174) — recurring concerns the user
// has returned to MORE THAN ONCE across DIFFERENT chats. Distinct from the
// utterance-mining tools (§165–§172): those extract a SHAPE of utterance
// (used-to / should / threshold / almost / imagined-future / vow). This
// extracts RECURRENCE — the meta-pattern over many utterances.
//
// Each loop carries time-weighted metrics:
//   chronicity_days — days from first_seen to last_seen
//   amplitude       — avg intensity per occurrence (1-5)
//   velocity        — escalating | stable | dampening | dormant
//
// Four novel resolutions, refusing the binary of resolve-or-accumulate:
//   break    — commit to something that ENDS the loop
//   widen    — introduce new information; the loop reframes
//   settle   — accept this loop as part of who you are (some loops are
//              ongoing care, not problems to fix — "missing my dad isn't a
//              problem to fix, it's the shape of love now")
//   archive  — soft-hide; the loop resolved on its own
//
// SETTLE is the novel hook: the recognition that some loops should not be
// closed but neither should they accumulate as unfinished. They become
// part of the self.

import { z } from "zod";
import { defineTool } from "./types";

type Loop = {
  id: string;
  scan_id: string;
  topic_text: string;
  loop_kind: string;
  domain: string;
  first_seen_date: string;
  last_seen_date: string;
  occurrence_count: number;
  distinct_chat_count: number;
  chronicity_days: number;
  amplitude: number;
  velocity: string;
  confidence: number;
  evidence_message_ids: string[];
  status: string;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  active: number;
  broken: number;
  widened: number;
  settled: number;
  dismissed: number;
  pinned: number;
  chronic_active: number;
  escalating_active: number;
  dormant_active: number;
  avg_amplitude_active: number;
  avg_chronicity_active: number;
  biggest_active_amplitude: number;
  by_kind: Record<string, number>;
  by_domain: Record<string, number>;
  by_velocity: Record<string, number>;
};

export const scanLoopsRegisterTool = defineTool({
  name: "scan_loops_register",
  description: [
    "Mine the user's chats for RECURRING CONCERNS — themes returned to more",
    "than once across different chats over the window. Different mechanism",
    "from utterance-mining: no trigger phrases, the model reads a sample",
    "evenly across the window and decides what counts as recurrence.",
    "",
    "For each loop captures: topic_text (specific phrasing of the concern),",
    "loop_kind (question / fear / problem / fantasy / scene_replay /",
    "grievance / craving / regret_gnaw / other), domain, occurrence_count,",
    "distinct_chat_count, chronicity_days (how long the loop has been live),",
    "amplitude 1-5 (avg intensity per occurrence), velocity (escalating /",
    "stable / dampening / dormant — read by comparing recent occurrences to",
    "older ones).",
    "",
    "Costs an LLM call (15-30s). Default window 365 days (loops need",
    "temporal coverage so velocity can be read). Min window 60 days.",
    "UPSERTs by exact topic_text so rescans tighten the metrics rather than",
    "duplicate.",
    "",
    "Use when the user asks 'what do I keep coming back to', 'what loops am",
    "I in', 'what am I stuck on', 'what scenes do I replay', 'what do I",
    "keep wanting', or as the meta-companion to any utterance-mining scan.",
    "Loops are the pattern OVER utterances; this tool answers a different",
    "question than the others.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(60).max(730).optional().default(365),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (60-730, default 365)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/loops-register/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 365 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `loops scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      updated?: number;
      latency_ms?: number;
      message?: string;
      loops?: Loop[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      updated: j.updated ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      loops: (j.loops ?? []).map((l) => ({
        id: l.id,
        topic_text: l.topic_text,
        loop_kind: l.loop_kind,
        domain: l.domain,
        first_seen_date: l.first_seen_date,
        last_seen_date: l.last_seen_date,
        occurrence_count: l.occurrence_count,
        distinct_chat_count: l.distinct_chat_count,
        chronicity_days: l.chronicity_days,
        amplitude: l.amplitude,
        velocity: l.velocity,
        confidence: l.confidence,
      })),
    };
  },
});

export const listLoopsRegisterTool = defineTool({
  name: "list_loops_register",
  description: [
    "List loops in the user's register plus stats. Filters:",
    "  status               (active | broken | widened | settled | archived",
    "                        | dismissed | pinned | all, default active)",
    "  kind                 (question | fear | problem | fantasy |",
    "                        scene_replay | grievance | craving | regret_gnaw",
    "                        | other | all)",
    "  domain               (work | health | relationships | family |",
    "                        finance | creative | self | spiritual | other |",
    "                        all)",
    "  velocity             (escalating | stable | dampening | dormant | all)",
    "  min_amplitude        (1-5, default 1)",
    "  min_chronicity_days  (default 0)",
    "  pinned               (true to filter pinned only)",
    "  limit                (default 30, max 200)",
    "",
    "Returns loops + stats including chronic_active (active loops over 6mo",
    "old — THE diagnostic category), escalating_active, dormant_active,",
    "settled count, by_kind / by_domain / by_velocity buckets, avg amplitude",
    "and chronicity for active loops, biggest_active_amplitude.",
    "",
    "Use when the user asks 'what am I stuck on', 'what's been bothering me",
    "for ages', 'what loops am I in', or 'what's escalating'. Surface",
    "topic_text VERBATIM and ALWAYS name chronicity + velocity together —",
    "an escalating 200-day loop is a different fact from a stable 30-day",
    "loop and the user needs both numbers to reckon with what's true.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "broken", "widened", "settled", "archived", "dismissed", "pinned", "all"]).optional().default("active"),
    kind: z.enum(["question", "fear", "problem", "fantasy", "scene_replay", "grievance", "craving", "regret_gnaw", "other", "all"]).optional().default("all"),
    domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"]).optional().default("all"),
    velocity: z.enum(["escalating", "stable", "dampening", "dormant", "all"]).optional().default("all"),
    min_amplitude: z.number().int().min(1).max(5).optional().default(1),
    min_chronicity_days: z.number().int().min(0).max(3650).optional().default(0),
    pinned: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "broken", "widened", "settled", "archived", "dismissed", "pinned", "all"] },
      kind: { type: "string", enum: ["question", "fear", "problem", "fantasy", "scene_replay", "grievance", "craving", "regret_gnaw", "other", "all"] },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"] },
      velocity: { type: "string", enum: ["escalating", "stable", "dampening", "dormant", "all"] },
      min_amplitude: { type: "number" },
      min_chronicity_days: { type: "number" },
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
    const status = input.status ?? "active";
    if (status === "pinned") {
      params.set("pinned", "true");
    } else if (status !== "all") {
      params.set("status", status);
    }
    if (status === "archived" || status === "all") params.set("include_archived", "true");
    if (input.kind && input.kind !== "all") params.set("kind", input.kind);
    if (input.domain && input.domain !== "all") params.set("domain", input.domain);
    if (input.velocity && input.velocity !== "all") params.set("velocity", input.velocity);
    if (input.min_amplitude && input.min_amplitude > 1) params.set("min_amplitude", String(input.min_amplitude));
    if (input.min_chronicity_days && input.min_chronicity_days > 0) params.set("min_chronicity_days", String(input.min_chronicity_days));
    if (input.pinned) params.set("pinned", "true");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/loops-register?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { loops?: Loop[]; stats?: Stats };
    const rows = j.loops ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      loops: rows.map((l) => ({
        id: l.id,
        topic_text: l.topic_text,
        loop_kind: l.loop_kind,
        domain: l.domain,
        first_seen_date: l.first_seen_date,
        last_seen_date: l.last_seen_date,
        occurrence_count: l.occurrence_count,
        distinct_chat_count: l.distinct_chat_count,
        chronicity_days: l.chronicity_days,
        amplitude: l.amplitude,
        velocity: l.velocity,
        confidence: l.confidence,
        status: l.status,
        status_note: l.status_note,
        pinned: l.pinned,
      })),
    };
  },
});

export const respondToLoopTool = defineTool({
  name: "respond_to_loop",
  description: [
    "Resolve, edit, or annotate a loop. Specify exactly one mode:",
    "",
    "  break   — commit to something that ENDS this loop. status_note IS",
    "            the specific commitment that closes the loop (REQUIRED —",
    "            server rejects empty). Use when the user names the action",
    "            they will take that makes the recurrence stop. Examples:",
    "              'should I quit my job' -> break with note 'I'm handing my",
    "              notice in on Monday. The loop ends because the question",
    "              becomes a fact.'",
    "",
    "  widen   — introduce NEW information; the loop reframes (still alive",
    "            but in a different shape). status_note IS the new",
    "            information that recasts the loop (REQUIRED). Use when the",
    "            user has reframed but not closed. Examples:",
    "              'whether mum loves me' -> widen with note 'after the",
    "              conversation last week I see she expresses love through",
    "              worry. The question is no longer about whether but about",
    "              the language we share.'",
    "",
    "  settle  — accept this loop as part of who you are. status_note IS",
    "            why this loop is care, not a problem to solve (REQUIRED).",
    "            The novel resolution: refusing the binary of resolve-or-",
    "            accumulate. Some loops are ongoing care. Examples:",
    "              'missing my dad' -> settle with note 'this is not a",
    "              problem to fix. The missing IS the shape of love now.",
    "              The loop continues and that is right.'",
    "",
    "  archive   — soft hide. The loop resolved on its own / no longer",
    "              relevant.",
    "  dismiss   — false positive from the scan. Optional note.",
    "  unresolve — return to active.",
    "  pin / unpin — toggle pinned (pinned loops surface as shortcuts).",
    "  restore   — un-archive.",
    "  edit      — fix mis-extracted topic_text. Optional fields:",
    "              topic_text (4-280), status_note. ≥1 required.",
    "",
    "Use ONLY after the user has stated a clear stance. The four",
    "resolutions hold open four different futures for the loop. Never",
    "silently default — make the user pick. SETTLE is the most novel: it",
    "honours that some recurring concerns should not be closed but neither",
    "should they accumulate as unfinished.",
  ].join("\n"),
  schema: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("break"),
      loop_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (the specific commitment that ends this loop) is required for break").max(1500),
    }),
    z.object({
      action: z.literal("widen"),
      loop_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (the new information that reframes this loop) is required for widen").max(1500),
    }),
    z.object({
      action: z.literal("settle"),
      loop_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (why this loop is care, not a problem to fix) is required for settle").max(1500),
    }),
    z.object({
      action: z.literal("archive"),
      loop_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("dismiss"),
      loop_id: z.string().uuid(),
      status_note: z.string().max(1500).optional(),
    }),
    z.object({
      action: z.literal("unresolve"),
      loop_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("pin"),
      loop_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("unpin"),
      loop_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("restore"),
      loop_id: z.string().uuid(),
    }),
    z.object({
      action: z.literal("edit"),
      loop_id: z.string().uuid(),
      topic_text: z.string().min(4).max(280).optional(),
      status_note: z.string().max(1500).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["action", "loop_id"],
    properties: {
      action: { type: "string", enum: ["break", "widen", "settle", "archive", "dismiss", "unresolve", "pin", "unpin", "restore", "edit"] },
      loop_id: { type: "string" },
      status_note: { type: "string", description: "REQUIRED for break (the specific commitment that ends the loop), widen (the new information that reframes it), settle (why this is care not a problem); optional for dismiss/edit." },
      topic_text: { type: "string", description: "Optional for edit — replacement topic phrasing (4-280 chars)." },
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
    if (input.action === "break" || input.action === "widen" || input.action === "settle") {
      body.status_note = input.status_note;
    } else if (input.action === "dismiss") {
      if (input.status_note) body.status_note = input.status_note;
    } else if (input.action === "edit") {
      if (input.topic_text) body.topic_text = input.topic_text;
      if (input.status_note) body.status_note = input.status_note;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/loops-register/${input.loop_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { loop?: Loop };
    const l = j.loop;
    if (!l) return { ok: false, error: "no loop returned" };
    return {
      ok: true,
      loop_id: l.id,
      status: l.status,
      status_note: l.status_note,
      pinned: l.pinned,
      archived_at: l.archived_at,
      topic_text: l.topic_text,
      loop_kind: l.loop_kind,
      chronicity_days: l.chronicity_days,
      velocity: l.velocity,
      amplitude: l.amplitude,
    };
  },
});
