// §180 — list endpoint for the fear ledger.
//
// Filters: status / fear_kind / domain / pinned / min_charge /
//          include_archived / limit.
//
// THE NOVEL DIAGNOSTIC is FEAR_REALISATION_RATE — empirically how often the
// user's articulated fears actually came true. Pairs with §179
// gut_accuracy_rate to give an empirical view of the inner alarm system.
//
//   fear_realisation_rate = (realised + 0.5 * partially_realised) / resolved_total
//   per_kind_rate         — same per fear_kind (catastrophising / abandonment / ...)
//   per_domain_rate       — same per domain
//   most_realised_kind    — fear_kind with highest realisation rate (≥3 resolved)
//   least_realised_kind   — fear_kind with lowest realisation rate (≥3 resolved)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set([
  "open",
  "realised", "partially_realised",
  "dissolved", "displaced",
  "unresolved",
  "dismissed", "archived",
]);
const VALID_KIND = new Set([
  "catastrophising", "abandonment", "rejection", "failure",
  "loss", "shame", "inadequacy", "loss_of_control",
  "mortality", "future_uncertainty",
]);
const VALID_DOMAIN = new Set([
  "relationships", "work", "money", "health",
  "decision", "opportunity", "safety", "self", "unknown",
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
  const kind = url.searchParams.get("fear_kind");
  const domain = url.searchParams.get("domain");
  const pinnedOnly = url.searchParams.get("pinned") === "true";
  const includeArchived = url.searchParams.get("include_archived") === "true";
  const minChargeRaw = url.searchParams.get("min_charge");
  const minCharge = minChargeRaw ? Math.max(1, Math.min(5, parseInt(minChargeRaw, 10) || 1)) : null;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 500);

  let q = supabase
    .from("fears")
    .select("id, scan_id, fear_text, fear_kind, feared_subject, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, confidence, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("spoken_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeArchived) q = q.is("archived_at", null);
  if (status && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (kind && VALID_KIND.has(kind)) q = q.eq("fear_kind", kind);
  if (domain && VALID_DOMAIN.has(domain)) q = q.eq("domain", domain);
  if (pinnedOnly) q = q.eq("pinned", true);
  if (minCharge !== null) q = q.gte("charge", minCharge);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statRows } = await supabase
    .from("fears")
    .select("status, fear_kind, domain, charge, pinned")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const stats = {
    total: 0,
    open: 0,
    realised: 0,
    partially_realised: 0,
    dissolved: 0,
    displaced: 0,
    unresolved: 0,
    dismissed: 0,
    pinned: 0,
    load_bearing_open: 0,
    fear_realisation_rate: 0,
    fear_overrun_rate: 0,
    by_resolution: {
      realised: 0,
      partially_realised: 0,
      dissolved: 0,
      displaced: 0,
    },
    per_kind_rate: {} as Record<string, { realised: number; total: number; rate: number }>,
    per_domain_rate: {} as Record<string, { realised: number; total: number; rate: number }>,
    kind_counts: {} as Record<string, number>,
    open_kind_counts: {} as Record<string, number>,
    by_domain: {} as Record<string, number>,
    by_status: {} as Record<string, number>,
    most_common_open_kind: null as null | string,
    most_realised_kind: null as null | { kind: string; rate: number; total: number },
    least_realised_kind: null as null | { kind: string; rate: number; total: number },
  };

  if (statRows && statRows.length > 0) {
    let realisedWeighted = 0;
    let resolvedTotal = 0;
    const kindStat: Record<string, { realised: number; total: number }> = {};
    const domStat: Record<string, { realised: number; total: number }> = {};

    type Row = {
      status: string;
      fear_kind: string;
      domain: string;
      charge: number;
      pinned: boolean;
    };

    for (const r of statRows as Row[]) {
      stats.total += 1;
      stats.by_status[r.status] = (stats.by_status[r.status] || 0) + 1;
      stats.by_domain[r.domain] = (stats.by_domain[r.domain] || 0) + 1;
      stats.kind_counts[r.fear_kind] = (stats.kind_counts[r.fear_kind] || 0) + 1;
      if (r.pinned) stats.pinned += 1;

      if (r.status === "open") {
        stats.open += 1;
        stats.open_kind_counts[r.fear_kind] = (stats.open_kind_counts[r.fear_kind] || 0) + 1;
        if (r.charge >= 4) stats.load_bearing_open += 1;
      } else if (r.status === "realised") {
        stats.realised += 1;
        stats.by_resolution.realised += 1;
      } else if (r.status === "partially_realised") {
        stats.partially_realised += 1;
        stats.by_resolution.partially_realised += 1;
      } else if (r.status === "dissolved") {
        stats.dissolved += 1;
        stats.by_resolution.dissolved += 1;
      } else if (r.status === "displaced") {
        stats.displaced += 1;
        stats.by_resolution.displaced += 1;
      } else if (r.status === "unresolved") {
        stats.unresolved += 1;
      } else if (r.status === "dismissed") {
        stats.dismissed += 1;
      }

      // Realisation: realised counts 1.0, partially_realised counts 0.5,
      // dissolved/displaced count 0. Resolved-total denominator is the
      // sum of all four outcome resolutions.
      if (
        r.status === "realised" ||
        r.status === "partially_realised" ||
        r.status === "dissolved" ||
        r.status === "displaced"
      ) {
        resolvedTotal += 1;
        let weight = 0;
        if (r.status === "realised") weight = 1;
        else if (r.status === "partially_realised") weight = 0.5;
        realisedWeighted += weight;

        if (!kindStat[r.fear_kind]) kindStat[r.fear_kind] = { realised: 0, total: 0 };
        const ks = kindStat[r.fear_kind] as { realised: number; total: number };
        ks.total += 1;
        ks.realised += weight;

        if (!domStat[r.domain]) domStat[r.domain] = { realised: 0, total: 0 };
        const ds = domStat[r.domain] as { realised: number; total: number };
        ds.total += 1;
        ds.realised += weight;
      }
    }

    stats.fear_realisation_rate = rate(realisedWeighted, resolvedTotal);
    stats.fear_overrun_rate = rate(resolvedTotal - realisedWeighted, resolvedTotal);

    let bestKind: { kind: string; rate: number; total: number } | null = null;
    let worstKind: { kind: string; rate: number; total: number } | null = null;
    for (const [k, v] of Object.entries(kindStat)) {
      const r = rate(v.realised, v.total);
      stats.per_kind_rate[k] = { realised: v.realised, total: v.total, rate: r };
      if (v.total >= 3) {
        if (!bestKind || r > bestKind.rate) bestKind = { kind: k, rate: r, total: v.total };
        if (!worstKind || r < worstKind.rate) worstKind = { kind: k, rate: r, total: v.total };
      }
    }
    stats.most_realised_kind = bestKind;
    stats.least_realised_kind = worstKind;

    for (const [k, v] of Object.entries(domStat)) {
      stats.per_domain_rate[k] = { realised: v.realised, total: v.total, rate: rate(v.realised, v.total) };
    }

    let topKind: string | null = null;
    let topCount = 0;
    for (const [k, v] of Object.entries(stats.open_kind_counts)) {
      if (v > topCount) { topCount = v; topKind = k; }
    }
    stats.most_common_open_kind = topKind;
  }

  return NextResponse.json({ ok: true, fears: rows ?? [], stats });
}
