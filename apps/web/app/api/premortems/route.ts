// GET /api/premortems — list pre-mortem failure modes across all the
// user's decisions. Query: ?decision_id=…&status=watching|happened|avoided|dismissed|all
// Default status filter = watching (the open watch list).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const decisionId = url.searchParams.get("decision_id");
  const status = url.searchParams.get("status") ?? "watching";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 100;

  let q = supabase
    .from("decision_premortems")
    .select("id, decision_id, failure_mode, likelihood, mitigation, status, resolved_at, resolved_note, created_at, decisions(id, title, choice, created_at)")
    .eq("user_id", user.id);
  if (decisionId) q = q.eq("decision_id", decisionId);
  if (["watching", "happened", "avoided", "dismissed"].includes(status)) q = q.eq("status", status);
  q = q.order("status", { ascending: true }).order("likelihood", { ascending: false }).order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ premortems: data ?? [] });
}
