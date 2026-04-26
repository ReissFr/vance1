// GET /api/trajectories — list trajectory snapshots.
// Query params:
//   ?status=active|archived|pinned|all   (default: active = non-archived)
//   ?limit=N                              (default 30)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "active";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 30;

  let q = supabase
    .from("trajectories")
    .select("id, body_6m, body_12m, key_drivers, assumptions, confidence, source_counts, pinned, archived_at, created_at")
    .eq("user_id", user.id);

  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  // status === "all" → no extra filter

  q = q.order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trajectories: data ?? [] });
}
