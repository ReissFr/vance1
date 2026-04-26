// §179 — list endpoint for the gut-checks ledger.
//
// Filters: status / signal_kind / domain / pinned / min_charge /
//          include_archived / limit.
//
// Stats include the GUT_ACCURACY_RATE — empirically how often the user's
// gut turns out right, regardless of whether they followed it. Plus the
// QUADRANT distribution (followed gut x gut was right) which surfaces the
// user's intuition calibration.
//
//   gut_accuracy_rate = (verified_right + ignored_regret) / resolved_total
//   gut_trust_rate    = (verified_right + ignored_relief) / resolved_total
//   per_signal_rate   — same per signal_kind (warning / hunch / pull / ...)
//   per_domain_rate   — same per domain
//   most_reliable_signal — signal_kind with highest accuracy (≥3 resolved)
//   least_reliable_signal — signal_kind with lowest accuracy (≥3 resolved)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set([
  "open",
  "verified_right", "verified_wrong",
  "ignored_regret", "ignored_relief",
  "unresolved",
  "dismissed", "archived",
]);
const VALID_SIGNAL = new Set([
  "warning", "pull", "suspicion", "trust",
  "unease", "certainty", "dread", "nudge", "hunch",
]);
const VALID_DOMAIN = new Set([
  "relationships", "work", "money", "health",
  "decision", "opportunity", "risk", "self", "unknown",
]);

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
  const signal = url.searchParams.get("signal_kind");
  const domain = url.searchParams.get("domain");
  const pinnedOnly = url.searchParams.get("pinned") === "true";
  const includeArchived = url.searchParams.get("include_archived") === "true";
  const minChargeRaw = url.searchParams.get("min_charge");
  const minCharge = minChargeRaw ? Math.max(1, Math.min(5, parseInt(minChargeRaw, 10) || 1)) : null;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 500);

  let q = supabase
    .from("gut_checks")
    .select("id, scan_id, gut_text, signal_kind, subject_text, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, confidence, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("spoken_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeArchived) q = q.is("archived_at", null);
  if (status && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (signal && VALID_SIGNAL.has(signal)) q = q.eq("signal_kind", signal);
  if (domain && VALID_DOMAIN.has(domain)) q = q.eq("domain", domain);
  if (pinnedOnly) q = q.eq("pinned", true);
  if (minCharge !== null) q = q.gte("charge", minCharge);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statRows } = await supabase
    .from("gut_checks")
    .select("status, signal_kind, domain, charge, pinned")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const stats = {
    total: 0,
    open: 0,
    verified_right: 0,
    verified_wrong: 0,
    ignored_regret: 0,
    ignored_relief: 0,
    unresolved: 0,
    dismissed: 0,
    pinned: 0,
    load_bearing_open: 0,
    gut_accuracy_rate: 0,
    gut_trust_rate: 0,
    quadrant: {
      verified_right: 0,
      verified_wrong: 0,
      ignored_regret: 0,
      ignored_relief: 0,
    },
    per_signal_rate: {} as Record<string, { right: number; total: number; rate: number }>,
    per_domain_rate: {} as Record<string, { right: number; total: number; rate: number }>,
    signal_counts: {} as Record<string, number>,
    open_signal_counts: {} as Record<string, number>,
    by_domain: {} as Record<string, number>,
    by_status: {} as Record<string, number>,
    most_common_open_signal: null as null | string,
    most_reliable_signal: null as null | { signal: string; rate: number; total: number },
    least_reliable_signal: null as null | { signal: string; rate: number; total: number },
  };

  if (statRows && statRows.length > 0) {
    let resolvedRight = 0;
    let resolvedTotal = 0;
    let trustHits = 0;
    const sigStat: Record<string, { right: number; total: number }> = {};
    const domStat: Record<string, { right: number; total: number }> = {};

    type Row = {
      status: string;
      signal_kind: string;
      domain: string;
      charge: number;
      pinned: boolean;
    };

    for (const r of statRows as Row[]) {
      stats.total += 1;
      stats.by_status[r.status] = (stats.by_status[r.status] || 0) + 1;
      stats.by_domain[r.domain] = (stats.by_domain[r.domain] || 0) + 1;
      stats.signal_counts[r.signal_kind] = (stats.signal_counts[r.signal_kind] || 0) + 1;
      if (r.pinned) stats.pinned += 1;

      if (r.status === "open") {
        stats.open += 1;
        stats.open_signal_counts[r.signal_kind] = (stats.open_signal_counts[r.signal_kind] || 0) + 1;
        if (r.charge >= 4) stats.load_bearing_open += 1;
      } else if (r.status === "verified_right") {
        stats.verified_right += 1;
        stats.quadrant.verified_right += 1;
      } else if (r.status === "verified_wrong") {
        stats.verified_wrong += 1;
        stats.quadrant.verified_wrong += 1;
      } else if (r.status === "ignored_regret") {
        stats.ignored_regret += 1;
        stats.quadrant.ignored_regret += 1;
      } else if (r.status === "ignored_relief") {
        stats.ignored_relief += 1;
        stats.quadrant.ignored_relief += 1;
      } else if (r.status === "unresolved") {
        stats.unresolved += 1;
      } else if (r.status === "dismissed") {
        stats.dismissed += 1;
      }

      // Accuracy: gut was right (verified_right OR ignored_regret —
      // user followed-and-vindicated, or didn't-follow-and-regretted).
      // Trust: outcome was right (verified_right OR ignored_relief —
      // user followed-and-vindicated, or didn't-follow-and-was-right
      // to ignore).
      if (
        r.status === "verified_right" ||
        r.status === "verified_wrong" ||
        r.status === "ignored_regret" ||
        r.status === "ignored_relief"
      ) {
        resolvedTotal += 1;
        const gutWasRight = r.status === "verified_right" || r.status === "ignored_regret";
        const trustHit = r.status === "verified_right" || r.status === "ignored_relief";
        if (gutWasRight) resolvedRight += 1;
        if (trustHit) trustHits += 1;

        if (!sigStat[r.signal_kind]) sigStat[r.signal_kind] = { right: 0, total: 0 };
        const ss = sigStat[r.signal_kind] as { right: number; total: number };
        ss.total += 1;
        if (gutWasRight) ss.right += 1;

        if (!domStat[r.domain]) domStat[r.domain] = { right: 0, total: 0 };
        const ds = domStat[r.domain] as { right: number; total: number };
        ds.total += 1;
        if (gutWasRight) ds.right += 1;
      }
    }

    stats.gut_accuracy_rate = rate(resolvedRight, resolvedTotal);
    stats.gut_trust_rate = rate(trustHits, resolvedTotal);

    let bestSig: { signal: string; rate: number; total: number } | null = null;
    let worstSig: { signal: string; rate: number; total: number } | null = null;
    for (const [k, v] of Object.entries(sigStat)) {
      const r = rate(v.right, v.total);
      stats.per_signal_rate[k] = { right: v.right, total: v.total, rate: r };
      if (v.total >= 3) {
        if (!bestSig || r > bestSig.rate) bestSig = { signal: k, rate: r, total: v.total };
        if (!worstSig || r < worstSig.rate) worstSig = { signal: k, rate: r, total: v.total };
      }
    }
    stats.most_reliable_signal = bestSig;
    stats.least_reliable_signal = worstSig;

    for (const [k, v] of Object.entries(domStat)) {
      stats.per_domain_rate[k] = { right: v.right, total: v.total, rate: rate(v.right, v.total) };
    }

    let topSig: string | null = null;
    let topCount = 0;
    for (const [k, v] of Object.entries(stats.open_signal_counts)) {
      if (v > topCount) { topCount = v; topSig = k; }
    }
    stats.most_common_open_signal = topSig;
  }

  return NextResponse.json({ ok: true, gut_checks: rows ?? [], stats });
}
