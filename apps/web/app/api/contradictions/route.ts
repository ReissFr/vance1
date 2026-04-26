// §176 — list endpoint for the contradictions ledger.
// Filters: status / kind / domain / min_charge / min_days_apart / pinned /
//          include_archived / limit.
// Stats include per-status / per-kind / per-domain buckets, plus
// load_bearing (charge=5 active) and longest_unreconciled (max days_apart
// among open).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set(["open", "evolved", "dual", "confused", "rejected", "dismissed", "archived"]);
const VALID_KINDS = new Set([
  "preference", "belief", "claim", "commitment",
  "identity", "value", "desire", "appraisal",
]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");
  const domain = url.searchParams.get("domain");
  const minCharge = parseInt(url.searchParams.get("min_charge") || "1", 10) || 1;
  const minDaysApart = parseInt(url.searchParams.get("min_days_apart") || "0", 10) || 0;
  const pinnedOnly = url.searchParams.get("pinned") === "true";
  const includeArchived = url.searchParams.get("include_archived") === "true";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 500);

  let q = supabase
    .from("contradictions")
    .select("id, scan_id, statement_a, statement_a_date, statement_a_msg_id, statement_b, statement_b_date, statement_b_msg_id, topic, contradiction_kind, domain, charge, confidence, days_apart, status, resolution_note, resolved_at, pinned, archived_at, created_at, updated_at")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("charge", { ascending: false })
    .order("statement_b_date", { ascending: false })
    .limit(limit);

  if (!includeArchived) q = q.is("archived_at", null);
  if (status && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (kind && VALID_KINDS.has(kind)) q = q.eq("contradiction_kind", kind);
  if (domain && VALID_DOMAINS.has(domain)) q = q.eq("domain", domain);
  if (minCharge > 1) q = q.gte("charge", minCharge);
  if (minDaysApart > 0) q = q.gte("days_apart", minDaysApart);
  if (pinnedOnly) q = q.eq("pinned", true);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statRows } = await supabase
    .from("contradictions")
    .select("status, contradiction_kind, domain, charge, days_apart, pinned")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const stats = {
    total: 0,
    open: 0,
    evolved: 0,
    dual: 0,
    confused: 0,
    rejected: 0,
    dismissed: 0,
    pinned: 0,
    load_bearing_open: 0,
    longest_unreconciled_days: 0,
    avg_charge_open: 0,
    by_status: {} as Record<string, number>,
    by_kind: {} as Record<string, number>,
    by_domain: {} as Record<string, number>,
  };

  if (statRows && statRows.length > 0) {
    let openChargeSum = 0;
    let openCount = 0;
    for (const r of statRows as Array<{ status: string; contradiction_kind: string; domain: string; charge: number; days_apart: number; pinned: boolean }>) {
      stats.total += 1;
      stats.by_status[r.status] = (stats.by_status[r.status] || 0) + 1;
      stats.by_kind[r.contradiction_kind] = (stats.by_kind[r.contradiction_kind] || 0) + 1;
      stats.by_domain[r.domain] = (stats.by_domain[r.domain] || 0) + 1;
      if (r.pinned) stats.pinned += 1;

      if (r.status === "open") {
        stats.open += 1;
        if (r.charge === 5) stats.load_bearing_open += 1;
        if (r.days_apart > stats.longest_unreconciled_days) stats.longest_unreconciled_days = r.days_apart;
        openChargeSum += r.charge;
        openCount += 1;
      } else if (r.status === "evolved") stats.evolved += 1;
      else if (r.status === "dual") stats.dual += 1;
      else if (r.status === "confused") stats.confused += 1;
      else if (r.status === "rejected") stats.rejected += 1;
      else if (r.status === "dismissed") stats.dismissed += 1;
    }
    stats.avg_charge_open = openCount > 0 ? Math.round((openChargeSum / openCount) * 10) / 10 : 0;
  }

  return NextResponse.json({ ok: true, contradictions: rows ?? [], stats });
}
