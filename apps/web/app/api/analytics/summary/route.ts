import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(Number(searchParams.get("days") ?? 7), 30));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const admin = supabaseAdmin();
  const { data: events, error } = await admin
    .from("analytics_events")
    .select("event, path, session_id, source, properties, created_at")
    .eq("user_id", user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (events ?? []) as Array<{
    event: string;
    path: string | null;
    session_id: string | null;
    source: string | null;
    properties: Record<string, unknown> | null;
    created_at: string;
  }>;

  const eventCounts: Record<string, number> = {};
  const pathCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const sessions = new Set<string>();
  const perDayByDate: Record<string, number> = {};

  for (const r of rows) {
    eventCounts[r.event] = (eventCounts[r.event] ?? 0) + 1;
    if (r.source) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
    if (r.session_id) sessions.add(r.session_id);
    if (r.path && r.event === "$pageview") {
      pathCounts[r.path] = (pathCounts[r.path] ?? 0) + 1;
    }
    const day = r.created_at.slice(0, 10);
    perDayByDate[day] = (perDayByDate[day] ?? 0) + 1;
  }

  const topEvents = Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([event, count]) => ({ event, count }));
  const topPaths = Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));
  const sources = Object.entries(sourceCounts).map(([source, count]) => ({ source, count }));

  const perDay: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    perDay.push({ date: d, count: perDayByDate[d] ?? 0 });
  }

  return NextResponse.json({
    totals: {
      events: rows.length,
      sessions: sessions.size,
      pageviews: eventCounts["$pageview"] ?? 0,
    },
    topEvents,
    topPaths,
    sources,
    perDay,
    recent: rows.slice(0, 60),
  });
}
