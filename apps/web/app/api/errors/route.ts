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
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);
  const severity = searchParams.get("severity");
  const route = searchParams.get("route");

  const admin = supabaseAdmin();
  let q = admin
    .from("error_events")
    .select("id, user_id, route, method, message, stack, context, severity, sentry_forwarded, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (severity) q = q.eq("severity", severity);
  if (route) q = q.eq("route", route);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: buckets } = await admin
    .from("error_events")
    .select("route")
    .eq("user_id", user.id)
    .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());

  const counts: Record<string, number> = {};
  for (const row of (buckets ?? []) as Array<{ route: string | null }>) {
    const k = row.route ?? "(unknown)";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const topRoutes = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([route, count]) => ({ route, count }));

  return NextResponse.json({ errors: data ?? [], topRoutes });
}
