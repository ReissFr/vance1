// Per-kind performance breakdown — task count, success rate, avg cost, avg
// latency. Powers the "AGENT PERFORMANCE" section on /costs. Aggregates from
// the `tasks` table over a sliding window (?days=).

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Row = {
  kind: string | null;
  status: string | null;
  cost_usd: number | null;
  started_at: string | null;
  completed_at: string | null;
};

type KindStats = {
  kind: string;
  total: number;
  succeeded: number;
  failed: number;
  needs_approval: number;
  running: number;
  queued: number;
  cancelled: number;
  success_rate: number | null;
  total_cost_usd: number;
  avg_cost_usd: number;
  avg_latency_seconds: number | null;
  latency_samples: number;
};

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(Number(searchParams.get("days") ?? 30), 90));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("tasks")
    .select("kind, status, cost_usd, started_at, completed_at")
    .eq("user_id", user.id)
    .gte("created_at", since)
    .limit(10000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  const byKind: Record<string, KindStats & { _latencySum: number }> = {};

  for (const r of rows) {
    const kind = r.kind ?? "unknown";
    const bucket =
      byKind[kind] ??
      (byKind[kind] = {
        kind,
        total: 0,
        succeeded: 0,
        failed: 0,
        needs_approval: 0,
        running: 0,
        queued: 0,
        cancelled: 0,
        success_rate: null,
        total_cost_usd: 0,
        avg_cost_usd: 0,
        avg_latency_seconds: null,
        latency_samples: 0,
        _latencySum: 0,
      });
    bucket.total += 1;
    bucket.total_cost_usd += Number(r.cost_usd ?? 0);

    switch (r.status) {
      case "done":
        bucket.succeeded += 1;
        break;
      case "failed":
        bucket.failed += 1;
        break;
      case "needs_approval":
        bucket.needs_approval += 1;
        break;
      case "running":
        bucket.running += 1;
        break;
      case "queued":
        bucket.queued += 1;
        break;
      case "cancelled":
        bucket.cancelled += 1;
        break;
    }

    if (
      r.status === "done" &&
      r.started_at &&
      r.completed_at
    ) {
      const ms =
        new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
      if (ms >= 0 && ms < 24 * 3600 * 1000) {
        bucket._latencySum += ms;
        bucket.latency_samples += 1;
      }
    }
  }

  const result: KindStats[] = Object.values(byKind).map((b) => {
    const terminal = b.succeeded + b.failed;
    const stats: KindStats = {
      kind: b.kind,
      total: b.total,
      succeeded: b.succeeded,
      failed: b.failed,
      needs_approval: b.needs_approval,
      running: b.running,
      queued: b.queued,
      cancelled: b.cancelled,
      success_rate: terminal > 0 ? b.succeeded / terminal : null,
      total_cost_usd: round4(b.total_cost_usd),
      avg_cost_usd: b.total > 0 ? round4(b.total_cost_usd / b.total) : 0,
      avg_latency_seconds:
        b.latency_samples > 0
          ? Math.round(b._latencySum / b.latency_samples / 100) / 10
          : null,
      latency_samples: b.latency_samples,
    };
    return stats;
  });

  result.sort((a, b) => b.total - a.total);

  return NextResponse.json({ days, kinds: result });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
