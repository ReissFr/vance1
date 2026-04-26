// GET /api/belief-contradictions — list pairs.
//   ?status=open|resolved|dismissed|all (default open)
//   ?claim_id=uuid (optional filter)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RESOLVED_SET = ["resolved_changed_mind", "resolved_still_true", "resolved_one_off"];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const claimId = url.searchParams.get("claim_id");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 30;

  let q = supabase
    .from("belief_contradictions")
    .select(
      "id, claim_id, claim_kind, claim_text, evidence_kind, evidence_id, evidence_text, evidence_date, severity, note, status, resolved_at, resolved_note, scan_window_days, created_at",
    )
    .eq("user_id", user.id);

  if (status === "open") q = q.eq("status", "open");
  else if (status === "resolved") q = q.in("status", RESOLVED_SET);
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  // status === "all" → no filter

  if (claimId) q = q.eq("claim_id", claimId);

  q = q.order("severity", { ascending: false }).order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contradictions: data ?? [] });
}
