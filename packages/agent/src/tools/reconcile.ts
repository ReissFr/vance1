// Brain tools for Reality Reconciliation — said-vs-did drift detection.
//
// The reconciliation page (/reconcile) does the full word-overlap matching
// across wins/standups/reflections. These brain tools surface the most
// actionable drift quickly: overdue commitments, overdue predictions,
// stalled goals (no win lately, target date nearing), and uncompleted
// intentions. Use when the user asks "what am I behind on", "what's
// drifting", "what did I say I'd do but haven't", "anything I'm forgetting".

import { z } from "zod";
import { defineTool } from "./types";

function todayIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function daysUntilDate(yyyyMmDd: string): number {
  const target = new Date(yyyyMmDd + "T00:00:00Z").getTime();
  return Math.round((target - Date.now()) / 86_400_000);
}

export const findDriftTool = defineTool({
  name: "find_drift",
  description: [
    "Surface drift between what the user said they'd do and what they",
    "actually did. Returns the most actionable items: overdue commitments,",
    "overdue predictions (resolve verdict due), stalled active goals (target",
    "date nearing), and recent uncompleted daily intentions.",
    "",
    "Use when the user asks: 'what am I behind on', 'anything drifting',",
    "'what did I say I would do but haven't', 'reconcile', 'check on me'.",
    "Optional: kind filter to one category. Optional: window_days for how",
    "far back to look (default 30, used for intentions).",
  ].join("\n"),
  schema: z.object({
    kind: z
      .enum(["all", "commitments", "predictions", "goals", "intentions"])
      .optional()
      .default("all"),
    window_days: z.number().int().min(1).max(180).optional().default(30),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["all", "commitments", "predictions", "goals", "intentions"],
      },
      window_days: { type: "number" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const kind = input.kind ?? "all";
    const windowDays = input.window_days ?? 30;
    const limit = input.limit ?? 20;
    const today = todayDate();
    const todayTs = todayIso();
    const windowStart = new Date(Date.now() - windowDays * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const out: Array<{
      kind: string;
      severity: "high" | "medium" | "low";
      id: string;
      text: string;
      gap_days: number;
      note: string;
    }> = [];

    if (kind === "all" || kind === "commitments") {
      const { data } = await ctx.supabase
        .from("commitments")
        .select("id, commitment_text, other_party, deadline")
        .eq("user_id", ctx.userId)
        .eq("direction", "outbound")
        .eq("status", "open")
        .not("deadline", "is", null)
        .lt("deadline", todayTs)
        .order("deadline", { ascending: true })
        .limit(limit);
      for (const r of (data ?? []) as Array<{ id: string; commitment_text: string; other_party: string; deadline: string }>) {
        const overdue = daysSince(r.deadline);
        out.push({
          kind: "commitment_overdue",
          severity: overdue > 14 ? "high" : overdue > 3 ? "medium" : "low",
          id: r.id,
          text: `${r.commitment_text} · to ${r.other_party}`,
          gap_days: overdue,
          note: "you said you'd do this, the deadline has passed",
        });
      }
    }

    if (kind === "all" || kind === "predictions") {
      const { data } = await ctx.supabase
        .from("predictions")
        .select("id, claim, confidence, resolve_by")
        .eq("user_id", ctx.userId)
        .eq("status", "open")
        .lt("resolve_by", today)
        .order("resolve_by", { ascending: true })
        .limit(limit);
      for (const r of (data ?? []) as Array<{ id: string; claim: string; confidence: number; resolve_by: string }>) {
        const overdue = -daysUntilDate(r.resolve_by);
        out.push({
          kind: "prediction_overdue",
          severity: overdue > 14 ? "high" : overdue > 3 ? "medium" : "low",
          id: r.id,
          text: `${r.claim} · ${r.confidence}%`,
          gap_days: overdue,
          note: "resolve verdict to keep calibration honest",
        });
      }
    }

    if (kind === "all" || kind === "goals") {
      const { data } = await ctx.supabase
        .from("goals")
        .select("id, title, target_date, progress_pct")
        .eq("user_id", ctx.userId)
        .eq("status", "active")
        .not("target_date", "is", null)
        .order("target_date", { ascending: true })
        .limit(limit);
      for (const r of (data ?? []) as Array<{ id: string; title: string; target_date: string; progress_pct: number | null }>) {
        const days = daysUntilDate(r.target_date);
        const progress = r.progress_pct ?? 0;
        if (days > 45) continue;
        if (progress >= 90) continue;
        out.push({
          kind: "goal_stalled",
          severity: days < 14 ? "high" : days < 30 ? "medium" : "low",
          id: r.id,
          text: `${r.title} · target ${r.target_date} · ${progress}%`,
          gap_days: days,
          note: "target date nearing, progress incomplete",
        });
      }
    }

    if (kind === "all" || kind === "intentions") {
      const { data } = await ctx.supabase
        .from("intentions")
        .select("id, log_date, text")
        .eq("user_id", ctx.userId)
        .is("completed_at", null)
        .gte("log_date", windowStart)
        .lt("log_date", today)
        .order("log_date", { ascending: false })
        .limit(limit);
      for (const r of (data ?? []) as Array<{ id: string; log_date: string; text: string }>) {
        const ageDays = -daysUntilDate(r.log_date);
        out.push({
          kind: "intention_unmatched",
          severity: ageDays > 7 ? "high" : ageDays > 3 ? "medium" : "low",
          id: r.id,
          text: r.text,
          gap_days: ageDays,
          note: "set as a daily intention, never marked complete",
        });
      }
    }

    const sevRank = { high: 0, medium: 1, low: 2 } as const;
    out.sort((a, b) => {
      const s = sevRank[a.severity] - sevRank[b.severity];
      if (s !== 0) return s;
      return b.gap_days - a.gap_days;
    });

    const byKind: Record<string, number> = {};
    for (const s of out) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;

    return {
      ok: true,
      total: out.length,
      by_kind: byKind,
      drift: out.slice(0, limit),
    };
  },
});
