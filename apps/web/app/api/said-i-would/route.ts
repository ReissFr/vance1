// §175 — list endpoint for the said-i-would ledger.
// Filters: status / horizon_kind / domain / overdue / due_within / pinned /
//          include_archived / limit.
// Stats include the FOLLOW-THROUGH calibration which is the novel
// diagnostic value:
//   follow_through_rate          = kept / (kept + partial + broken + forgotten)
//   per_domain_rate              = same per domain
//   per_horizon_rate             = same per horizon_kind
//   overdue_count                = pending + target_date < today
//   due_this_week                = pending + target_date in [today, +7d]
//   due_today                    = pending + target_date = today

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set(["pending", "kept", "partial", "broken", "forgotten", "dismissed"]);
const VALID_HORIZON = new Set([
  "today", "tomorrow", "this_week", "this_weekend", "next_week",
  "this_month", "next_month", "soon", "eventually", "unspecified",
]);
const VALID_DOMAIN = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDaysYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rate(num: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const horizonKind = url.searchParams.get("horizon_kind");
  const domain = url.searchParams.get("domain");
  const overdueOnly = url.searchParams.get("overdue") === "true";
  const dueWithinRaw = url.searchParams.get("due_within");
  const pinnedOnly = url.searchParams.get("pinned") === "true";
  const includeArchived = url.searchParams.get("include_archived") === "true";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 500);

  const today = todayYmd();

  let q = supabase
    .from("said_i_woulds")
    .select("id, scan_id, promise_text, horizon_text, horizon_kind, domain, spoken_date, spoken_message_id, conversation_id, target_date, confidence, status, resolution_note, resolved_at, pinned, archived_at, created_at, updated_at")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("target_date", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeArchived) q = q.is("archived_at", null);
  if (status && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (horizonKind && VALID_HORIZON.has(horizonKind)) q = q.eq("horizon_kind", horizonKind);
  if (domain && VALID_DOMAIN.has(domain)) q = q.eq("domain", domain);
  if (overdueOnly) {
    q = q.eq("status", "pending").lt("target_date", today);
  }
  if (dueWithinRaw) {
    const n = parseInt(dueWithinRaw, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 365) {
      q = q.eq("status", "pending").gte("target_date", today).lte("target_date", plusDaysYmd(n));
    }
  }
  if (pinnedOnly) q = q.eq("pinned", true);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statRows } = await supabase
    .from("said_i_woulds")
    .select("status, domain, horizon_kind, target_date, pinned")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const stats = {
    total: 0,
    pending: 0,
    kept: 0,
    partial: 0,
    broken: 0,
    forgotten: 0,
    dismissed: 0,
    pinned: 0,
    overdue_count: 0,
    due_today: 0,
    due_this_week: 0,
    follow_through_rate: 0,
    follow_through_loose: 0,
    per_domain_rate: {} as Record<string, { kept: number; total: number; rate: number }>,
    per_horizon_rate: {} as Record<string, { kept: number; total: number; rate: number }>,
    by_domain: {} as Record<string, number>,
    by_horizon: {} as Record<string, number>,
    by_status: {} as Record<string, number>,
  };

  if (statRows && statRows.length > 0) {
    const sevenDays = plusDaysYmd(7);
    let resolvedKept = 0;
    let resolvedAny = 0;
    let resolvedKeptOrPartial = 0;
    const domStat: Record<string, { kept: number; total: number }> = {};
    const horStat: Record<string, { kept: number; total: number }> = {};

    for (const r of statRows as Array<{ status: string; domain: string; horizon_kind: string; target_date: string; pinned: boolean }>) {
      stats.total += 1;
      stats.by_status[r.status] = (stats.by_status[r.status] || 0) + 1;
      stats.by_domain[r.domain] = (stats.by_domain[r.domain] || 0) + 1;
      stats.by_horizon[r.horizon_kind] = (stats.by_horizon[r.horizon_kind] || 0) + 1;
      if (r.pinned) stats.pinned += 1;

      if (r.status === "pending") {
        stats.pending += 1;
        if (r.target_date < today) stats.overdue_count += 1;
        else if (r.target_date === today) stats.due_today += 1;
        if (r.target_date >= today && r.target_date <= sevenDays) stats.due_this_week += 1;
      } else if (r.status === "kept") stats.kept += 1;
      else if (r.status === "partial") stats.partial += 1;
      else if (r.status === "broken") stats.broken += 1;
      else if (r.status === "forgotten") stats.forgotten += 1;
      else if (r.status === "dismissed") stats.dismissed += 1;

      // Calibration excludes pending and dismissed (dismissed = scan
      // false-positive, not the user's call). Resolved = kept | partial |
      // broken | forgotten.
      if (r.status === "kept" || r.status === "partial" || r.status === "broken" || r.status === "forgotten") {
        resolvedAny += 1;
        if (r.status === "kept") resolvedKept += 1;
        if (r.status === "kept" || r.status === "partial") resolvedKeptOrPartial += 1;

        if (!domStat[r.domain]) domStat[r.domain] = { kept: 0, total: 0 };
        const ds = domStat[r.domain] as { kept: number; total: number };
        ds.total += 1;
        if (r.status === "kept") ds.kept += 1;

        if (!horStat[r.horizon_kind]) horStat[r.horizon_kind] = { kept: 0, total: 0 };
        const hs = horStat[r.horizon_kind] as { kept: number; total: number };
        hs.total += 1;
        if (r.status === "kept") hs.kept += 1;
      }
    }

    stats.follow_through_rate = rate(resolvedKept, resolvedAny);
    stats.follow_through_loose = rate(resolvedKeptOrPartial, resolvedAny);

    for (const [k, v] of Object.entries(domStat)) {
      stats.per_domain_rate[k] = { kept: v.kept, total: v.total, rate: rate(v.kept, v.total) };
    }
    for (const [k, v] of Object.entries(horStat)) {
      stats.per_horizon_rate[k] = { kept: v.kept, total: v.total, rate: rate(v.kept, v.total) };
    }
  }

  return NextResponse.json({ ok: true, promises: rows ?? [], stats, today });
}
