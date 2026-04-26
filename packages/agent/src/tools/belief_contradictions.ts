// Brain tools for the belief-vs-behaviour scanner. The user has two
// streams of writing — what they BELIEVE (identity claims, especially
// `value` and `refuse`) and what they LIVE (decisions, standups, wins,
// reflections, intentions, daily check-ins). When those drift, JARVIS
// surfaces concrete pairs the user can look at and decide whether
// they've changed their mind, the slip was a one-off, or the belief
// still holds and they need to course-correct.
//
// Use these tools when the user asks "where am I drifting", "do my
// actions match what I say I value", "show me my hypocrisies", "have I
// been living my values", or before any major decision so the brain
// can flag a clash with a stated `refuse` clause.

import { z } from "zod";
import { defineTool } from "./types";

type ScanResponse = {
  generated?: Array<Record<string, unknown>>;
  skipped_existing?: number;
  note?: string;
};

type ContradictionRow = {
  id: string;
  claim_id: string;
  claim_kind: string;
  claim_text: string;
  evidence_kind: string;
  evidence_id: string;
  evidence_text: string;
  evidence_date: string;
  severity: number;
  note: string | null;
  status: string;
  scan_window_days: number | null;
  created_at: string;
};

export const scanBeliefContradictionsTool = defineTool({
  name: "scan_belief_contradictions",
  description: [
    "Run a fresh scan over the user's active identity claims (especially",
    "`value` and `refuse` kinds) against their recent behaviour",
    "(decisions, standups, wins, reflections, intentions, daily check-",
    "ins) and write back structured contradiction pairs. Each pair joins",
    "exactly one belief with exactly one piece of behaviour and includes",
    "a short note explaining the clash plus a severity 1-5.",
    "",
    "Optional: window_days (14|30|60|90, default 60), max (1-20, default 8).",
    "Returns: count of new pairs and a preview of the top 3.",
    "",
    "Use when the user says 'where am I drifting', 'check whether I'm",
    "living my values', 'show me my hypocrisies', 'audit my behaviour',",
    "or any phrase that asks for an integrity check. Also good to run",
    "before /weekly_review or after a heavy decision day. Re-running",
    "won't duplicate already-open pairs.",
  ].join("\n"),
  schema: z.object({
    window_days: z.union([z.literal(14), z.literal(30), z.literal(60), z.literal(90)]).optional().default(60),
    max: z.number().int().min(1).max(20).optional().default(8),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", enum: [14, 30, 60, 90] },
      max: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /belief-contradictions" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/belief-contradictions/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 60, max: input.max ?? 8 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as ScanResponse;
    const generated = (j.generated ?? []) as ContradictionRow[];
    return {
      ok: true,
      count: generated.length,
      skipped_existing: j.skipped_existing ?? 0,
      note: j.note ?? null,
      preview: generated.slice(0, 3).map((g) => ({
        id: g.id,
        claim_kind: g.claim_kind,
        claim_text: g.claim_text,
        evidence_kind: g.evidence_kind,
        evidence_date: g.evidence_date,
        severity: g.severity,
        note: g.note,
      })),
    };
  },
});

export const listBeliefContradictionsTool = defineTool({
  name: "list_belief_contradictions",
  description: [
    "List the user's stored belief-vs-behaviour contradiction pairs.",
    "Optional: status (open | resolved | dismissed | all, default open);",
    "claim_id (filter to one identity claim); limit (default 20).",
    "Returns each pair with the stated belief, the conflicting evidence,",
    "severity, and a short note explaining the clash.",
    "",
    "Use when the user asks 'what am I contradicting myself on', 'show",
    "me my open clashes', or before drafting/scheduling/deciding on the",
    "user's behalf so the brain can flag actions that would deepen an",
    "already-open clash with a stated value or refusal.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "resolved", "dismissed", "all"]).optional().default("open"),
    claim_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "resolved", "dismissed", "all"] },
      claim_id: { type: "string" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = input.limit ?? 20;
    let q = ctx.supabase
      .from("belief_contradictions")
      .select(
        "id, claim_id, claim_kind, claim_text, evidence_kind, evidence_id, evidence_text, evidence_date, severity, note, status, scan_window_days, created_at",
      )
      .eq("user_id", ctx.userId);
    if (status === "open") q = q.eq("status", "open");
    else if (status === "resolved") q = q.in("status", ["resolved_changed_mind", "resolved_still_true", "resolved_one_off"]);
    else if (status === "dismissed") q = q.eq("status", "dismissed");
    if (input.claim_id) q = q.eq("claim_id", input.claim_id);
    q = q.order("severity", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as ContradictionRow[];
    return {
      ok: true,
      count: rows.length,
      contradictions: rows.map((r) => ({
        id: r.id,
        claim_id: r.claim_id,
        claim_kind: r.claim_kind,
        claim_text: r.claim_text,
        evidence_kind: r.evidence_kind,
        evidence_id: r.evidence_id,
        evidence_text: r.evidence_text,
        evidence_date: r.evidence_date,
        severity: r.severity,
        note: r.note,
        status: r.status,
        created_at: r.created_at,
      })),
    };
  },
});

export const resolveBeliefContradictionTool = defineTool({
  name: "resolve_belief_contradiction",
  description: [
    "Resolve an open belief-vs-behaviour contradiction. Status options:",
    "- 'resolved_changed_mind' — the belief no longer holds (the user",
    "  should retire or rewrite the identity claim afterwards)",
    "- 'resolved_still_true' — belief still holds; user is re-aligning",
    "- 'resolved_one_off' — slip was an exception, not a pattern",
    "- 'dismissed' — the brain was wrong; this isn't a real clash",
    "",
    "Optional note (≤600 chars) is stored alongside the resolution.",
    "",
    "Use when the user says 'mark that one resolved', 'I've changed my",
    "mind on X', 'that was a one-off', or 'that wasn't a real",
    "contradiction'.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    status: z.enum([
      "resolved_changed_mind",
      "resolved_still_true",
      "resolved_one_off",
      "dismissed",
    ]),
    note: z.string().max(600).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "status"],
    properties: {
      id: { type: "string" },
      status: {
        type: "string",
        enum: [
          "resolved_changed_mind",
          "resolved_still_true",
          "resolved_one_off",
          "dismissed",
        ],
      },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /belief-contradictions" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/belief-contradictions/${input.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ status: input.status, note: input.note }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `resolve failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { contradiction?: ContradictionRow };
    return {
      ok: true,
      contradiction: j.contradiction
        ? {
            id: j.contradiction.id,
            status: j.contradiction.status,
            claim_text: j.contradiction.claim_text,
          }
        : null,
    };
  },
});
