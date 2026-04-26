// GET /api/phantom-limbs — list phantom limbs.
//   ?status=pending|acknowledged|contested|resolved|dismissed|pinned|archived|all  (default pending)
//   ?min_haunting=1..5 (default 2 — filter trivial flickers)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const minHauntingRaw = parseInt(url.searchParams.get("min_haunting") ?? "2", 10);
  const minHaunting = Math.max(1, Math.min(5, isNaN(minHauntingRaw) ? 2 : minHauntingRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("phantom_limbs")
    .select("id, scan_id, topic, topic_aliases, claim_text, claim_kind, claim_date, claim_message_id, claim_conversation_id, days_since_claim, post_mention_count, post_mention_days, post_mentions, haunting_score, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("status", "acknowledged");
  else if (status === "contested") q = q.eq("status", "contested");
  else if (status === "resolved") q = q.eq("status", "resolved");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (minHaunting > 1) q = q.gte("haunting_score", minHaunting);

  if (status === "pending") {
    q = q.order("haunting_score", { ascending: false }).order("post_mention_count", { ascending: false });
  } else {
    q = q.order("created_at", { ascending: false });
  }
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Stats across all non-archived rows for the dashboard
  const { data: statsRows } = await supabase
    .from("phantom_limbs")
    .select("status, archived_at, haunting_score")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{ status: string; archived_at: string | null; haunting_score: number }>;
  const live = all.filter((r) => !r.archived_at);
  const counts = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    acknowledged: live.filter((r) => r.status === "acknowledged").length,
    contested: live.filter((r) => r.status === "contested").length,
    resolved: live.filter((r) => r.status === "resolved").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    haunting_5: live.filter((r) => r.status === "pending" && r.haunting_score === 5).length,
    haunting_4: live.filter((r) => r.status === "pending" && r.haunting_score === 4).length,
  };

  return NextResponse.json({
    phantom_limbs: data ?? [],
    stats: counts,
  });
}
