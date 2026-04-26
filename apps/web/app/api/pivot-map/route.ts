// GET /api/pivot-map — list pivots.
//   ?status=pending|acknowledged|contested|superseded|dismissed|pinned|archived|all (default pending)
//   ?quality=stuck|performed|reverted|quiet|too_recent|all (default all)
//   ?domain=work|relationships|health|identity|finance|creative|learning|daily|other|all (default all)
//   ?min_confidence=1..5 (default 2)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_QUALITY = new Set(["stuck", "performed", "reverted", "quiet", "too_recent"]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const quality = url.searchParams.get("quality") ?? "all";
  const domain = url.searchParams.get("domain") ?? "all";
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("pivots")
    .select("id, scan_id, pivot_text, pivot_kind, domain, pivot_date, pivot_message_id, pivot_conversation_id, from_state, to_state, from_aliases, to_aliases, days_since_pivot, follow_through_count, follow_through_days, back_slide_count, back_slide_days, follow_through_samples, back_slide_samples, pivot_quality, confidence, status, status_note, pinned, archived_at, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("status", "acknowledged");
  else if (status === "contested") q = q.eq("status", "contested");
  else if (status === "superseded") q = q.eq("status", "superseded");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (quality !== "all" && VALID_QUALITY.has(quality)) {
    q = q.eq("pivot_quality", quality);
  }
  if (domain !== "all" && VALID_DOMAINS.has(domain)) {
    q = q.eq("domain", domain);
  }
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);

  q = q.order("pivot_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Stats across all non-archived rows
  const { data: statsRows } = await supabase
    .from("pivots")
    .select("status, archived_at, pivot_quality, domain, follow_through_count, back_slide_count")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    pivot_quality: string;
    domain: string;
    follow_through_count: number;
    back_slide_count: number;
  }>;
  const live = all.filter((r) => !r.archived_at);
  const stats = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    acknowledged: live.filter((r) => r.status === "acknowledged").length,
    contested: live.filter((r) => r.status === "contested").length,
    superseded: live.filter((r) => r.status === "superseded").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    quality: {
      stuck: live.filter((r) => r.pivot_quality === "stuck").length,
      performed: live.filter((r) => r.pivot_quality === "performed").length,
      reverted: live.filter((r) => r.pivot_quality === "reverted").length,
      quiet: live.filter((r) => r.pivot_quality === "quiet").length,
      too_recent: live.filter((r) => r.pivot_quality === "too_recent").length,
    },
    domain_counts: {
      work: live.filter((r) => r.domain === "work").length,
      relationships: live.filter((r) => r.domain === "relationships").length,
      health: live.filter((r) => r.domain === "health").length,
      identity: live.filter((r) => r.domain === "identity").length,
      finance: live.filter((r) => r.domain === "finance").length,
      creative: live.filter((r) => r.domain === "creative").length,
      learning: live.filter((r) => r.domain === "learning").length,
      daily: live.filter((r) => r.domain === "daily").length,
      other: live.filter((r) => r.domain === "other").length,
    },
  };

  return NextResponse.json({
    pivots: data ?? [],
    stats,
  });
}
