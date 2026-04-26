// GET /api/echoes — list echoes
//   ?status=open|dismissed|all (default open)
//   ?source_kind=reflection|decision|daily_checkin (optional filter)
//   ?source_id=<uuid> (optional, lists echoes FOR one specific source)
//   ?min_similarity=1..5 (optional, default 1)
//   ?limit=N (default 50, max 200)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set(["reflection", "decision", "daily_checkin"]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const sourceKind = url.searchParams.get("source_kind");
  const sourceId = url.searchParams.get("source_id");
  const minSim = parseInt(url.searchParams.get("min_similarity") ?? "1", 10);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  let q = supabase
    .from("echoes")
    .select(
      "id, source_kind, source_id, source_text_excerpt, source_date, match_kind, match_id, match_text_excerpt, match_date, similarity, similarity_note, user_note, dismissed_at, created_at",
    )
    .eq("user_id", user.id);
  if (status === "open") q = q.is("dismissed_at", null);
  else if (status === "dismissed") q = q.not("dismissed_at", "is", null);
  if (sourceKind && VALID_KINDS.has(sourceKind)) q = q.eq("source_kind", sourceKind);
  if (sourceId) q = q.eq("source_id", sourceId);
  if (Number.isFinite(minSim) && minSim >= 1 && minSim <= 5) q = q.gte("similarity", minSim);
  q = q.order("source_date", { ascending: false }).order("similarity", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ echoes: data ?? [] });
}
