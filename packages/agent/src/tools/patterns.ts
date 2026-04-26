// Brain tools for the PATTERN LIBRARY — causal patterns surfaced from the
// user's own logged data. The first feature in JARVIS that does cause-effect
// analysis: "When you log a standup after 23:00, your next-day energy drops
// below 3 in 4 of 5 cases." Scans across daily_checkins, standups,
// intentions, decisions, reflections, wins, habit_logs and seeds the model
// with quantitative summaries computed server-side. The model returns 0-6
// patterns; the user can confirm, contest, or dismiss each.

import { z } from "zod";
import { defineTool } from "./types";

type Example = { date: string; antecedent_evidence: string; consequent_evidence: string };

type Pattern = {
  id: string;
  scan_id: string | null;
  relation_kind: string;
  antecedent: string;
  consequent: string;
  statement: string;
  nuance: string | null;
  domain: string;
  direction: string;
  lift: number | null;
  support_count: number | null;
  total_count: number | null;
  strength: number;
  source_signal: string | null;
  examples: Example[];
  candidate_intervention: string | null;
  user_status: string | null;
  user_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  resolved_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

export const scanPatternsTool = defineTool({
  name: "scan_patterns",
  description: [
    "Run a PATTERN SCAN across the user's logged data — check-ins,",
    "standups, intentions, decisions, reflections, wins, habit-logs —",
    "and surface 0-6 causal patterns. Each pattern is a one-sentence",
    "statement with antecedent → consequent and quantified support",
    "(e.g. 'When you log a standup after 23:00, your next-day energy",
    "drops below 3 in 4 of 5 cases.'). Costs an LLM round-trip (8-15s)",
    "and reads heavily — once a fortnight is plenty.",
    "",
    "Use when the user asks 'what patterns am I in', 'what tends to",
    "precede what in my data', 'find the cause-effect links in my",
    "behaviour', 'what does my data say about my decisions / energy /",
    "mood / focus', 'show me the patterns I'm not seeing'.",
    "",
    "Optional: window_days (30-365, default 120),",
    "domain_focus (energy | mood | focus | time | decisions |",
    "relationships | work | habits | money | mixed) to bias the scan",
    "toward one area.",
    "",
    "Returns inserted patterns. New patterns land 'open' — the user",
    "must confirm / contest / dismiss via respond_to_pattern.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(365).optional(),
    domain_focus: z.enum(["energy", "mood", "focus", "time", "decisions", "relationships", "work", "habits", "money", "mixed"]).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number" },
      domain_focus: { type: "string", enum: ["energy", "mood", "focus", "time", "decisions", "relationships", "work", "habits", "money", "mixed"] },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/patterns/scan`, {
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
      patterns?: Pattern[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      patterns: (j.patterns ?? []).map((p) => ({
        id: p.id,
        relation_kind: p.relation_kind,
        antecedent: p.antecedent,
        consequent: p.consequent,
        statement: p.statement,
        nuance: p.nuance,
        domain: p.domain,
        direction: p.direction,
        lift: p.lift,
        support_count: p.support_count,
        total_count: p.total_count,
        strength: p.strength,
        candidate_intervention: p.candidate_intervention,
      })),
    };
  },
});

export const listPatternsTool = defineTool({
  name: "list_patterns",
  description: [
    "List the user's surfaced patterns — causal links between event types",
    "the user has confirmed, contested, dismissed, or hasn't yet",
    "responded to. Optional: status (open | confirmed | contested |",
    "dismissed | resolved | archived | pinned | all, default open),",
    "domain (one of energy | mood | focus | time | decisions |",
    "relationships | work | habits | money | mixed),",
    "limit (default 30, max 100).",
    "",
    "Worth calling before any planning conversation so you can speak",
    "to patterns the user has confirmed. CONFIRMED patterns are the",
    "ones to weave into suggestions — 'you confirmed that decisions",
    "logged on low-mood days tend to reverse, so let's hold this one",
    "until tomorrow' is a powerful move.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "confirmed", "contested", "dismissed", "resolved", "archived", "pinned", "all"]).optional().default("open"),
    domain: z.enum(["energy", "mood", "focus", "time", "decisions", "relationships", "work", "habits", "money", "mixed"]).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "confirmed", "contested", "dismissed", "resolved", "archived", "pinned", "all"] },
      domain: { type: "string", enum: ["energy", "mood", "focus", "time", "decisions", "relationships", "work", "habits", "money", "mixed"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = Math.max(1, Math.min(100, input.limit ?? 30));

    let q = ctx.supabase
      .from("patterns")
      .select("id, scan_id, relation_kind, antecedent, consequent, statement, nuance, domain, direction, lift, support_count, total_count, strength, source_signal, examples, candidate_intervention, user_status, user_note, pinned, archived_at, resolved_at, created_at")
      .eq("user_id", ctx.userId);

    if (input.domain) q = q.eq("domain", input.domain);

    if (status === "open") q = q.is("user_status", null).is("archived_at", null);
    else if (status === "confirmed") q = q.eq("user_status", "confirmed");
    else if (status === "contested") q = q.eq("user_status", "contested");
    else if (status === "dismissed") q = q.eq("user_status", "dismissed");
    else if (status === "resolved") q = q.not("user_status", "is", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

    q = q.order("strength", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as Pattern[];

    return {
      ok: true,
      count: rows.length,
      patterns: rows.map((p) => ({
        id: p.id,
        relation_kind: p.relation_kind,
        antecedent: p.antecedent,
        consequent: p.consequent,
        statement: p.statement,
        nuance: p.nuance,
        domain: p.domain,
        direction: p.direction,
        lift: p.lift,
        support_count: p.support_count,
        total_count: p.total_count,
        strength: p.strength,
        candidate_intervention: p.candidate_intervention,
        user_status: p.user_status,
        user_note: p.user_note,
        pinned: p.pinned,
        archived: p.archived_at != null,
        resolved_at: p.resolved_at,
        created_at: p.created_at,
      })),
    };
  },
});

export const respondToPatternTool = defineTool({
  name: "respond_to_pattern",
  description: [
    "Resolve a pattern. Specify exactly one mode:",
    "",
    "  confirmed — yes, you see this pattern in your life now that it's",
    "              named. user_note recommended (the user's reaction).",
    "  contested — the pattern is real-looking but spurious / the model",
    "              is mistaken. user_note required.",
    "  dismissed — the pattern is uninteresting or already obvious.",
    "              Optional user_note.",
    "  pin / unpin       — keep visible at the top.",
    "  archive / restore — hide / unhide.",
    "",
    "Use ONLY when the user has explicitly responded to a specific",
    "pattern. Don't guess on their behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["confirmed", "contested", "dismissed", "pin", "unpin", "archive", "restore"]),
    user_note: z.string().min(1).max(800).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["confirmed", "contested", "dismissed", "pin", "unpin", "archive", "restore"] },
      user_note: { type: "string" },
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
    if (input.mode === "confirmed") {
      payload.status = "confirmed";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "contested") {
      if (!input.user_note) return { ok: false, error: "user_note required for mode=contested" };
      payload.status = "contested";
      payload.user_note = input.user_note;
    } else if (input.mode === "dismissed") {
      payload.status = "dismissed";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "pin") {
      payload.pin = true;
    } else if (input.mode === "unpin") {
      payload.pin = false;
    } else if (input.mode === "archive") {
      payload.archive = true;
    } else if (input.mode === "restore") {
      payload.restore = true;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/patterns/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { pattern?: Pattern };
    if (!j.pattern) return { ok: false, error: "no row returned" };
    const p = j.pattern;
    return {
      ok: true,
      pattern: {
        id: p.id,
        domain: p.domain,
        statement: p.statement,
        user_status: p.user_status,
        user_note: p.user_note,
        pinned: p.pinned,
        archived: p.archived_at != null,
      },
    };
  },
});
