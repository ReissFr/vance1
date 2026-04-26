// List the user's automations + a short preview of recent runs for each
// so the /automations UI can show "fired 2h ago ✓" badges without a second
// round-trip. RLS-scoped via supabaseServer().
//
// Also returns an aggregate stats block (`stats_7d`) with counts across the
// last 7 days — powers the activity header on /automations.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [automationsRes, runsRes, stats7Res] = await Promise.all([
    supabase
      .from("automations")
      .select(
        "id, title, description, trigger_kind, trigger_spec, action_chain, ask_first, enabled, last_fired_at, fire_count, next_fire_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("automation_runs")
      .select("id, automation_id, status, started_at, completed_at")
      .order("started_at", { ascending: false })
      .limit(50),
    supabase
      .from("automation_runs")
      .select("status")
      .gte("started_at", sevenDaysAgo),
  ]);

  const automations = automationsRes.data ?? [];
  const runs = runsRes.data ?? [];

  type Run = {
    id: string;
    automation_id: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
  };
  const recentByAutomation = new Map<string, Run[]>();
  for (const r of runs as Run[]) {
    const list = recentByAutomation.get(r.automation_id) ?? [];
    if (list.length < 3) list.push(r);
    recentByAutomation.set(r.automation_id, list);
  }

  const enriched = automations.map((a) => ({
    ...a,
    recent_runs: recentByAutomation.get(a.id as string) ?? [],
  }));

  const stats_7d = { total: 0, done: 0, failed: 0, awaiting_approval: 0 };
  for (const row of (stats7Res.data ?? []) as Array<{ status: string }>) {
    stats_7d.total += 1;
    if (row.status === "done") stats_7d.done += 1;
    else if (row.status === "failed") stats_7d.failed += 1;
    else if (row.status === "awaiting_approval") stats_7d.awaiting_approval += 1;
  }

  return NextResponse.json({ automations: enriched, stats_7d });
}
