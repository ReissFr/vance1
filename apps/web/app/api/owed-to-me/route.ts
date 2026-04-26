// §178 — list endpoint for the owed-to-me ledger.
// Filters: status / relationship_with / domain / overdue / due_within /
//          pinned / min_charge / include_archived / limit.
//
// Stats include the FOLLOW-THROUGH-RECEIVED calibration which is the
// novel diagnostic value for §178:
//   follow_through_received_rate = kept / (kept + broken + forgotten)
//   per_relationship_rate        = same per relationship_with — THE diagnostic
//   per_horizon_rate             = same per horizon_kind
//   raised_outcome_rate          = of raised slips, what happened?
//   overdue_count                = open + target_date < today
//   relationship_counts          — open per relationship (cross-tab panel)
//   most_promising_relationship  — highest follow-through rate
//   least_promising_relationship — lowest follow-through rate (≥3 resolved)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set([
  "open", "kept", "broken", "forgotten", "raised", "released",
  "dismissed", "archived",
]);
const VALID_RELATIONSHIP = new Set([
  "partner", "parent", "sibling", "friend",
  "colleague", "boss", "client", "stranger", "unknown",
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
  const relationship = url.searchParams.get("relationship_with");
  const domain = url.searchParams.get("domain");
  const overdueOnly = url.searchParams.get("overdue") === "true";
  const dueWithinRaw = url.searchParams.get("due_within");
  const pinnedOnly = url.searchParams.get("pinned") === "true";
  const includeArchived = url.searchParams.get("include_archived") === "true";
  const minChargeRaw = url.searchParams.get("min_charge");
  const minCharge = minChargeRaw ? Math.max(1, Math.min(5, parseInt(minChargeRaw, 10) || 1)) : null;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 500);

  const today = todayYmd();

  let q = supabase
    .from("owed_to_me")
    .select("id, scan_id, promise_text, horizon_text, horizon_kind, relationship_with, person_text, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, target_date, confidence, status, resolution_note, raised_outcome, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("target_date", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeArchived) q = q.is("archived_at", null);
  if (status && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (relationship && VALID_RELATIONSHIP.has(relationship)) q = q.eq("relationship_with", relationship);
  if (domain && VALID_DOMAIN.has(domain)) q = q.eq("domain", domain);
  if (overdueOnly) {
    q = q.eq("status", "open").lt("target_date", today);
  }
  if (dueWithinRaw) {
    const n = parseInt(dueWithinRaw, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 365) {
      q = q.eq("status", "open").gte("target_date", today).lte("target_date", plusDaysYmd(n));
    }
  }
  if (pinnedOnly) q = q.eq("pinned", true);
  if (minCharge !== null) q = q.gte("charge", minCharge);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statRows } = await supabase
    .from("owed_to_me")
    .select("status, relationship_with, domain, horizon_kind, charge, target_date, pinned, raised_outcome")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const stats = {
    total: 0,
    open: 0,
    kept: 0,
    broken: 0,
    forgotten: 0,
    raised: 0,
    released: 0,
    dismissed: 0,
    pinned: 0,
    overdue_count: 0,
    due_today: 0,
    due_this_week: 0,
    load_bearing_open: 0,
    follow_through_received_rate: 0,
    raised_follow_through_rate: 0,
    per_relationship_rate: {} as Record<string, { kept: number; total: number; rate: number }>,
    per_horizon_rate: {} as Record<string, { kept: number; total: number; rate: number }>,
    relationship_counts: {} as Record<string, number>,
    open_relationship_counts: {} as Record<string, number>,
    by_domain: {} as Record<string, number>,
    by_horizon: {} as Record<string, number>,
    by_status: {} as Record<string, number>,
    raised_outcome_counts: {} as Record<string, number>,
    most_common_open_relationship: null as null | string,
    least_promising_relationship: null as null | { relationship: string; rate: number; total: number },
    most_promising_relationship: null as null | { relationship: string; rate: number; total: number },
  };

  if (statRows && statRows.length > 0) {
    const sevenDays = plusDaysYmd(7);
    let resolvedKept = 0;
    let resolvedAny = 0;
    let raisedFollowed = 0;
    let raisedTotal = 0;
    const relStat: Record<string, { kept: number; total: number }> = {};
    const horStat: Record<string, { kept: number; total: number }> = {};

    type Row = {
      status: string;
      relationship_with: string;
      domain: string;
      horizon_kind: string;
      charge: number;
      target_date: string;
      pinned: boolean;
      raised_outcome: string | null;
    };

    for (const r of statRows as Row[]) {
      stats.total += 1;
      stats.by_status[r.status] = (stats.by_status[r.status] || 0) + 1;
      stats.by_domain[r.domain] = (stats.by_domain[r.domain] || 0) + 1;
      stats.by_horizon[r.horizon_kind] = (stats.by_horizon[r.horizon_kind] || 0) + 1;
      stats.relationship_counts[r.relationship_with] = (stats.relationship_counts[r.relationship_with] || 0) + 1;
      if (r.pinned) stats.pinned += 1;

      if (r.status === "open") {
        stats.open += 1;
        stats.open_relationship_counts[r.relationship_with] = (stats.open_relationship_counts[r.relationship_with] || 0) + 1;
        if (r.charge >= 4) stats.load_bearing_open += 1;
        if (r.target_date < today) stats.overdue_count += 1;
        else if (r.target_date === today) stats.due_today += 1;
        if (r.target_date >= today && r.target_date <= sevenDays) stats.due_this_week += 1;
      } else if (r.status === "kept") stats.kept += 1;
      else if (r.status === "broken") stats.broken += 1;
      else if (r.status === "forgotten") stats.forgotten += 1;
      else if (r.status === "raised") stats.raised += 1;
      else if (r.status === "released") stats.released += 1;
      else if (r.status === "dismissed") stats.dismissed += 1;

      // Calibration: kept | broken | forgotten only. Excludes raised
      // (still in flight), released (user let it go intentionally),
      // dismissed (false positive), open (still pending).
      if (r.status === "kept" || r.status === "broken" || r.status === "forgotten") {
        resolvedAny += 1;
        if (r.status === "kept") resolvedKept += 1;

        if (!relStat[r.relationship_with]) relStat[r.relationship_with] = { kept: 0, total: 0 };
        const rs = relStat[r.relationship_with] as { kept: number; total: number };
        rs.total += 1;
        if (r.status === "kept") rs.kept += 1;

        if (!horStat[r.horizon_kind]) horStat[r.horizon_kind] = { kept: 0, total: 0 };
        const hs = horStat[r.horizon_kind] as { kept: number; total: number };
        hs.total += 1;
        if (r.status === "kept") hs.kept += 1;
      }

      // Raised-outcome calibration — of the times the user raised it,
      // how often did the promiser actually follow through?
      if (r.raised_outcome) {
        stats.raised_outcome_counts[r.raised_outcome] = (stats.raised_outcome_counts[r.raised_outcome] || 0) + 1;
        raisedTotal += 1;
        if (r.raised_outcome === "they_followed_through") raisedFollowed += 1;
      }
    }

    stats.follow_through_received_rate = rate(resolvedKept, resolvedAny);
    stats.raised_follow_through_rate = rate(raisedFollowed, raisedTotal);

    let bestRel: { relationship: string; rate: number; total: number } | null = null;
    let worstRel: { relationship: string; rate: number; total: number } | null = null;
    for (const [k, v] of Object.entries(relStat)) {
      const r = rate(v.kept, v.total);
      stats.per_relationship_rate[k] = { kept: v.kept, total: v.total, rate: r };
      if (v.total >= 3) {
        if (!bestRel || r > bestRel.rate) bestRel = { relationship: k, rate: r, total: v.total };
        if (!worstRel || r < worstRel.rate) worstRel = { relationship: k, rate: r, total: v.total };
      }
    }
    stats.most_promising_relationship = bestRel;
    stats.least_promising_relationship = worstRel;

    for (const [k, v] of Object.entries(horStat)) {
      stats.per_horizon_rate[k] = { kept: v.kept, total: v.total, rate: rate(v.kept, v.total) };
    }

    let topRel: string | null = null;
    let topCount = 0;
    for (const [k, v] of Object.entries(stats.open_relationship_counts)) {
      if (v > topCount) { topCount = v; topRel = k; }
    }
    stats.most_common_open_relationship = topRel;
  }

  return NextResponse.json({ ok: true, owed_to_me: rows ?? [], stats, today });
}
