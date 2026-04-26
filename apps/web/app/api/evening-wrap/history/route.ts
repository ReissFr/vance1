// List the last N evening-wrap tasks so /evening-wrap can show a past-runs
// strip (re-read yesterday's wrap from desktop). Mirrors /api/briefing/history
// — metadata only; full text is fetched on demand via /api/tasks/[id].

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "14");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 60) : 14;

  const { data, error } = await supabase
    .from("tasks")
    .select("id, status, created_at, completed_at, args")
    .eq("user_id", user.id)
    .eq("kind", "evening_wrap")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const digests = (data ?? []).map((t) => ({
    id: t.id as string,
    status: t.status as string,
    created_at: t.created_at as string,
    completed_at: (t.completed_at as string | null) ?? null,
    title: ((t.args as { title?: string } | null) ?? null)?.title ?? "Evening wrap",
  }));

  return NextResponse.json({ ok: true, digests });
}
