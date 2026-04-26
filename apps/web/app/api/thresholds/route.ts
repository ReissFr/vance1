// GET /api/thresholds — list threshold crossings (§169) with stats.
//
// Query: ?status=active|integrated|dismissed|disputed|pinned|archived|all (default active)
//        ?pivot_kind=...|all
//        ?charge=growth|drift|mixed|all
//        ?min_magnitude=1-5
//        ?min_confidence=1-5
//        ?limit=N (default 80, max 300)

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_PIVOT_KINDS = new Set([
  "capability", "belief", "boundary", "habit", "identity", "aesthetic", "relational", "material",
]);
const VALID_CHARGES = new Set(["growth", "drift", "mixed"]);
const VALID_STATUSES = new Set(["active", "integrated", "dismissed", "disputed"]);

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status") ?? "active";
  const pivotKindRaw = searchParams.get("pivot_kind") ?? "all";
  const chargeRaw = searchParams.get("charge") ?? "all";
  const minMagRaw = parseInt(searchParams.get("min_magnitude") ?? "1", 10);
  const minConfRaw = parseInt(searchParams.get("min_confidence") ?? "2", 10);
  const limitRaw = parseInt(searchParams.get("limit") ?? "80", 10);

  const minMag = Number.isFinite(minMagRaw) ? Math.max(1, Math.min(5, minMagRaw)) : 1;
  const minConf = Number.isFinite(minConfRaw) ? Math.max(1, Math.min(5, minConfRaw)) : 2;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, limitRaw)) : 80;

  let query = supabase
    .from("thresholds")
    .select("id, scan_id, threshold_text, before_state, after_state, pivot_kind, charge, magnitude, domain, crossed_recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .eq("user_id", user.id)
    .gte("magnitude", minMag)
    .gte("confidence", minConf)
    .order("spoken_date", { ascending: false })
    .order("magnitude", { ascending: false })
    .limit(limit);

  if (statusRaw === "pinned") {
    query = query.eq("pinned", true).is("archived_at", null);
  } else if (statusRaw === "archived") {
    query = query.not("archived_at", "is", null);
  } else if (statusRaw !== "all") {
    if (!VALID_STATUSES.has(statusRaw)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    query = query.eq("status", statusRaw).is("archived_at", null);
  } else {
    query = query.is("archived_at", null);
  }

  if (pivotKindRaw !== "all") {
    if (!VALID_PIVOT_KINDS.has(pivotKindRaw)) return NextResponse.json({ error: "invalid pivot_kind" }, { status: 400 });
    query = query.eq("pivot_kind", pivotKindRaw);
  }

  if (chargeRaw !== "all") {
    if (!VALID_CHARGES.has(chargeRaw)) return NextResponse.json({ error: "invalid charge" }, { status: 400 });
    query = query.eq("charge", chargeRaw);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    pivot_kind: string;
    charge: string;
    magnitude: number;
    domain: string;
    status: string;
    pinned: boolean;
    archived_at: string | null;
    spoken_date: string;
  };
  const all = (rows ?? []) as Row[];

  const stats = {
    total: all.length,
    active: 0,
    integrated: 0,
    dismissed: 0,
    disputed: 0,
    pinned: 0,
    growth: 0,
    drift: 0,
    mixed: 0,
    high_magnitude: 0,
    drift_active: 0,
    growth_integrated: 0,
    pivot_kind_counts: {} as Record<string, number>,
    charge_by_pivot: {} as Record<string, { growth: number; drift: number; mixed: number }>,
    most_recent_drift: null as null | { id: string; spoken_date: string },
    biggest_growth: null as null | { id: string; spoken_date: string; magnitude: number },
  };

  for (const r of all) {
    if (r.status === "active") stats.active++;
    else if (r.status === "integrated") stats.integrated++;
    else if (r.status === "dismissed") stats.dismissed++;
    else if (r.status === "disputed") stats.disputed++;
    if (r.pinned) stats.pinned++;
    if (r.charge === "growth") stats.growth++;
    else if (r.charge === "drift") stats.drift++;
    else if (r.charge === "mixed") stats.mixed++;
    if (r.magnitude >= 4) stats.high_magnitude++;
    if (r.charge === "drift" && r.status === "active") stats.drift_active++;
    if (r.charge === "growth" && r.status === "integrated") stats.growth_integrated++;
    stats.pivot_kind_counts[r.pivot_kind] = (stats.pivot_kind_counts[r.pivot_kind] ?? 0) + 1;
    if (!stats.charge_by_pivot[r.pivot_kind]) {
      stats.charge_by_pivot[r.pivot_kind] = { growth: 0, drift: 0, mixed: 0 };
    }
    const chargeBucket = stats.charge_by_pivot[r.pivot_kind];
    if (chargeBucket && (r.charge === "growth" || r.charge === "drift" || r.charge === "mixed")) {
      chargeBucket[r.charge as "growth" | "drift" | "mixed"]++;
    }
    if (r.charge === "drift" && r.status === "active") {
      if (!stats.most_recent_drift || r.spoken_date > stats.most_recent_drift.spoken_date) {
        stats.most_recent_drift = { id: r.id, spoken_date: r.spoken_date };
      }
    }
    if (r.charge === "growth") {
      if (!stats.biggest_growth || r.magnitude > stats.biggest_growth.magnitude) {
        stats.biggest_growth = { id: r.id, spoken_date: r.spoken_date, magnitude: r.magnitude };
      }
    }
  }

  return NextResponse.json({ ok: true, thresholds: rows ?? [], stats });
}
