// GET /api/ventures — list all ventures for the user with summary stats.
// POST /api/ventures — create a new venture.
//
// CEO MODE foundation. A venture is one business JARVIS is operating.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set([
  "researching", "validated", "building", "launched", "scaling", "paused", "killed",
]);
const VALID_CADENCE = new Set(["daily", "twice_daily", "hourly", "weekly", "manual"]);

type VentureRow = {
  id: string;
  user_id: string;
  name: string;
  thesis: string;
  status: string;
  budget_pence: number;
  spent_pence: number;
  kill_criteria: string | null;
  decision_matrix: unknown;
  operator_memory: string;
  thesis_revision: number;
  cadence: string;
  next_heartbeat_at: string | null;
  last_heartbeat_at: string | null;
  launched_at: string | null;
  killed_at: string | null;
  killed_reason: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const includeKilled = url.searchParams.get("include_killed") === "true";

  let q = supabase
    .from("ventures")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (status && status !== "all" && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (!includeKilled && !status) q = q.neq("status", "killed");

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ventures = (data ?? []) as VentureRow[];

  const ventureIds = ventures.map((v) => v.id);
  const queuedCounts: Record<string, number> = {};
  const recentDecisionCounts: Record<string, number> = {};
  const unprocessedSignalCounts: Record<string, number> = {};
  const latestRevenue: Record<string, number> = {};

  if (ventureIds.length > 0) {
    const [queued, recent, signals, metrics] = await Promise.all([
      supabase
        .from("venture_decisions")
        .select("venture_id")
        .eq("user_id", user.id)
        .in("venture_id", ventureIds)
        .eq("status", "queued"),
      supabase
        .from("venture_decisions")
        .select("venture_id")
        .eq("user_id", user.id)
        .in("venture_id", ventureIds)
        .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
      supabase
        .from("venture_signals")
        .select("venture_id")
        .eq("user_id", user.id)
        .in("venture_id", ventureIds)
        .is("processed_at", null),
      supabase
        .from("venture_metrics")
        .select("venture_id, metric_kind, value, captured_for_date")
        .eq("user_id", user.id)
        .in("venture_id", ventureIds)
        .eq("metric_kind", "revenue_pence")
        .order("captured_for_date", { ascending: false })
        .limit(500),
    ]);

    for (const r of (queued.data ?? []) as { venture_id: string }[]) {
      queuedCounts[r.venture_id] = (queuedCounts[r.venture_id] ?? 0) + 1;
    }
    for (const r of (recent.data ?? []) as { venture_id: string }[]) {
      recentDecisionCounts[r.venture_id] = (recentDecisionCounts[r.venture_id] ?? 0) + 1;
    }
    for (const r of (signals.data ?? []) as { venture_id: string }[]) {
      unprocessedSignalCounts[r.venture_id] = (unprocessedSignalCounts[r.venture_id] ?? 0) + 1;
    }
    for (const m of (metrics.data ?? []) as { venture_id: string; value: number }[]) {
      if (latestRevenue[m.venture_id] === undefined) {
        latestRevenue[m.venture_id] = Number(m.value) || 0;
      }
    }
  }

  return NextResponse.json({
    ventures: ventures.map((v) => ({
      ...v,
      runway_pence: Math.max(0, v.budget_pence - v.spent_pence),
      queued_decisions: queuedCounts[v.id] ?? 0,
      recent_decisions_7d: recentDecisionCounts[v.id] ?? 0,
      unprocessed_signals: unprocessedSignalCounts[v.id] ?? 0,
      latest_revenue_pence: latestRevenue[v.id] ?? null,
    })),
    stats: {
      total: ventures.length,
      by_status: ventures.reduce<Record<string, number>>((acc, v) => {
        acc[v.status] = (acc[v.status] ?? 0) + 1;
        return acc;
      }, {}),
      total_budget_pence: ventures.reduce((acc, v) => acc + v.budget_pence, 0),
      total_spent_pence: ventures.reduce((acc, v) => acc + v.spent_pence, 0),
      total_queued_decisions: Object.values(queuedCounts).reduce((a, b) => a + b, 0),
    },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    thesis?: string;
    status?: string;
    budget_pence?: number;
    kill_criteria?: string;
    decision_matrix?: unknown;
    cadence?: string;
  } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const name = String(body.name ?? "").trim();
  const thesis = String(body.thesis ?? "").trim();
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "name must be 2-80 chars" }, { status: 400 });
  }
  if (thesis.length < 20 || thesis.length > 2000) {
    return NextResponse.json({ error: "thesis must be 20-2000 chars" }, { status: 400 });
  }

  const status = body.status && VALID_STATUS.has(body.status) ? body.status : "researching";
  const cadence = body.cadence && VALID_CADENCE.has(body.cadence) ? body.cadence : "daily";
  const budgetPence = Math.max(0, Math.round(Number(body.budget_pence ?? 0)));
  const killCriteria = body.kill_criteria ? String(body.kill_criteria).slice(0, 1000) : null;

  const insert: Record<string, unknown> = {
    user_id: user.id,
    name,
    thesis,
    status,
    cadence,
    budget_pence: budgetPence,
  };
  if (killCriteria) insert.kill_criteria = killCriteria;
  if (body.decision_matrix && typeof body.decision_matrix === "object") {
    insert.decision_matrix = body.decision_matrix;
  }
  if (cadence === "daily" || cadence === "twice_daily" || cadence === "hourly" || cadence === "weekly") {
    insert.next_heartbeat_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  const { data, error } = await supabase
    .from("ventures")
    .insert(insert)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, venture: data });
}
