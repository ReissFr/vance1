// GET /api/constitutions — list the user's constitution versions.
// Query: ?status=current|all|history|pinned|archived (default current),
//        ?limit=N (default 20).
//
// "current" returns just the most recent is_current=true row.
// "history" returns all non-archived rows newest first.
// "all" returns everything including archived.
// "pinned" returns pinned rows newest first.
// "archived" returns archived rows newest first.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "current";
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 20;

  let q = supabase
    .from("constitutions")
    .select("id, version, parent_id, preamble, body, articles, source_counts, diff_summary, is_current, pinned, archived_at, user_note, created_at, updated_at")
    .eq("user_id", user.id);

  if (status === "current") {
    q = q.eq("is_current", true);
  } else if (status === "history") {
    q = q.is("archived_at", null);
  } else if (status === "pinned") {
    q = q.eq("pinned", true).is("archived_at", null);
  } else if (status === "archived") {
    q = q.not("archived_at", "is", null);
  }

  q = q.order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ constitutions: data ?? [] });
}
