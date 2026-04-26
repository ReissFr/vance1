// GET /api/promises — list self-promises in the ledger.
//   ?status=pending|kept|broken|deferred|cancelled|unclear|resolved|due|overdue|pinned|archived|all
//     (default pending). 'resolved' = any non-pending. 'due' = pending and
//     deadline_date <= today. 'overdue' = pending and deadline_date < today.
//   ?category=habit|decision|relationship|health|work|creative|financial|identity|other
//   ?limit=N (default 60, max 200)
//
// Returns rows + a stats summary covering kept/broken/total resolved across
// all (non-archived) promises so the UI can show a self-trust rate.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const category = url.searchParams.get("category");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "60", 10);
  const limit = Math.max(1, Math.min(200, isNaN(limitRaw) ? 60 : limitRaw));

  const today = new Date().toISOString().slice(0, 10);

  let q = supabase
    .from("promises")
    .select("id, scan_id, action_summary, original_quote, category, deadline_text, deadline_date, promised_at, source_conversation_id, source_message_id, strength, repeat_count, prior_promise_id, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (category) q = q.eq("category", category);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "kept") q = q.eq("status", "kept");
  else if (status === "broken") q = q.eq("status", "broken");
  else if (status === "deferred") q = q.eq("status", "deferred");
  else if (status === "cancelled") q = q.eq("status", "cancelled");
  else if (status === "unclear") q = q.eq("status", "unclear");
  else if (status === "resolved") q = q.not("status", "eq", "pending");
  else if (status === "due") q = q.eq("status", "pending").is("archived_at", null).not("deadline_date", "is", null).lte("deadline_date", today);
  else if (status === "overdue") q = q.eq("status", "pending").is("archived_at", null).not("deadline_date", "is", null).lt("deadline_date", today);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);

  // Order: pending sorted by deadline_date asc with nulls last, then promised_at desc.
  // Resolved sorted by resolved_at desc.
  if (status === "pending" || status === "due" || status === "overdue") {
    q = q.order("deadline_date", { ascending: true, nullsFirst: false }).order("promised_at", { ascending: false });
  } else if (status === "resolved" || status === "kept" || status === "broken" || status === "deferred" || status === "cancelled" || status === "unclear") {
    q = q.order("resolved_at", { ascending: false, nullsFirst: false });
  } else {
    q = q.order("created_at", { ascending: false });
  }
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compute stats across the user's non-archived promises (independent of filter).
  const { data: statsRows } = await supabase
    .from("promises")
    .select("status, repeat_count, deadline_date, archived_at")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{ status: string; repeat_count: number; deadline_date: string | null; archived_at: string | null }>;
  const live = all.filter((r) => !r.archived_at);
  const resolved = live.filter((r) => r.status !== "pending");
  const kept = live.filter((r) => r.status === "kept").length;
  const broken = live.filter((r) => r.status === "broken").length;
  const deferred = live.filter((r) => r.status === "deferred").length;
  const cancelled = live.filter((r) => r.status === "cancelled").length;
  const unclear = live.filter((r) => r.status === "unclear").length;
  const pending = live.filter((r) => r.status === "pending").length;
  const overdue = live.filter((r) => r.status === "pending" && r.deadline_date != null && r.deadline_date < today).length;
  const repromised = live.filter((r) => r.repeat_count > 0).length;
  const denominator = kept + broken; // self-trust rate ignores deferred/cancelled/unclear
  const selfTrustRate = denominator > 0 ? Math.round((kept / denominator) * 100) : null;

  return NextResponse.json({
    promises: data ?? [],
    stats: {
      total: live.length,
      pending,
      overdue,
      kept,
      broken,
      deferred,
      cancelled,
      unclear,
      resolved: resolved.length,
      repromised,
      self_trust_rate: selfTrustRate,
    },
  });
}
