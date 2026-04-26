// GET /api/almosts — list near-misses (§170) with stats.
//
// Query: ?status=active|honoured|mourned|retried|dismissed|pinned|archived|all (default active)
//        ?kind=...|all
//        ?regret_tilt=relief|regret|mixed|all
//        ?min_weight=1-5
//        ?min_confidence=1-5
//        ?limit=N (default 80, max 300)

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_KINDS = new Set([
  "reaching_out", "saying_no", "leaving", "staying", "starting", "quitting",
  "spending", "refusing", "confronting", "asking", "confessing", "other",
]);
const VALID_TILTS = new Set(["relief", "regret", "mixed"]);
const VALID_STATUSES = new Set(["active", "honoured", "mourned", "retried", "dismissed"]);

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status") ?? "active";
  const kindRaw = searchParams.get("kind") ?? "all";
  const tiltRaw = searchParams.get("regret_tilt") ?? "all";
  const minWeightRaw = parseInt(searchParams.get("min_weight") ?? "1", 10);
  const minConfRaw = parseInt(searchParams.get("min_confidence") ?? "2", 10);
  const limitRaw = parseInt(searchParams.get("limit") ?? "80", 10);

  const minWeight = Number.isFinite(minWeightRaw) ? Math.max(1, Math.min(5, minWeightRaw)) : 1;
  const minConf = Number.isFinite(minConfRaw) ? Math.max(1, Math.min(5, minConfRaw)) : 2;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, limitRaw)) : 80;

  let query = supabase
    .from("almosts")
    .select("id, scan_id, act_text, pulled_back_by, consequence_imagined, kind, domain, weight, recency, regret_tilt, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, retry_intention_id, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .eq("user_id", user.id)
    .gte("weight", minWeight)
    .gte("confidence", minConf)
    .order("spoken_date", { ascending: false })
    .order("weight", { ascending: false })
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

  if (kindRaw !== "all") {
    if (!VALID_KINDS.has(kindRaw)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    query = query.eq("kind", kindRaw);
  }

  if (tiltRaw !== "all") {
    if (!VALID_TILTS.has(tiltRaw)) return NextResponse.json({ error: "invalid regret_tilt" }, { status: 400 });
    query = query.eq("regret_tilt", tiltRaw);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    kind: string;
    regret_tilt: string;
    weight: number;
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
    honoured: 0,
    mourned: 0,
    retried: 0,
    dismissed: 0,
    pinned: 0,
    relief: 0,
    regret: 0,
    mixed: 0,
    high_weight: 0,
    regret_active: 0,
    relief_honoured: 0,
    regret_retried: 0,
    kind_counts: {} as Record<string, number>,
    tilt_by_kind: {} as Record<string, { relief: number; regret: number; mixed: number }>,
    most_recent_regret: null as null | { id: string; spoken_date: string },
    biggest_relief: null as null | { id: string; spoken_date: string; weight: number },
    biggest_regret: null as null | { id: string; spoken_date: string; weight: number },
  };

  for (const r of all) {
    if (r.status === "active") stats.active++;
    else if (r.status === "honoured") stats.honoured++;
    else if (r.status === "mourned") stats.mourned++;
    else if (r.status === "retried") stats.retried++;
    else if (r.status === "dismissed") stats.dismissed++;
    if (r.pinned) stats.pinned++;
    if (r.regret_tilt === "relief") stats.relief++;
    else if (r.regret_tilt === "regret") stats.regret++;
    else if (r.regret_tilt === "mixed") stats.mixed++;
    if (r.weight >= 4) stats.high_weight++;
    if (r.regret_tilt === "regret" && r.status === "active") stats.regret_active++;
    if (r.regret_tilt === "relief" && r.status === "honoured") stats.relief_honoured++;
    if (r.regret_tilt === "regret" && r.status === "retried") stats.regret_retried++;
    stats.kind_counts[r.kind] = (stats.kind_counts[r.kind] ?? 0) + 1;
    if (!stats.tilt_by_kind[r.kind]) {
      stats.tilt_by_kind[r.kind] = { relief: 0, regret: 0, mixed: 0 };
    }
    const tiltBucket = stats.tilt_by_kind[r.kind];
    if (tiltBucket && (r.regret_tilt === "relief" || r.regret_tilt === "regret" || r.regret_tilt === "mixed")) {
      tiltBucket[r.regret_tilt as "relief" | "regret" | "mixed"]++;
    }
    if (r.regret_tilt === "regret" && r.status === "active") {
      if (!stats.most_recent_regret || r.spoken_date > stats.most_recent_regret.spoken_date) {
        stats.most_recent_regret = { id: r.id, spoken_date: r.spoken_date };
      }
    }
    if (r.regret_tilt === "relief") {
      if (!stats.biggest_relief || r.weight > stats.biggest_relief.weight) {
        stats.biggest_relief = { id: r.id, spoken_date: r.spoken_date, weight: r.weight };
      }
    }
    if (r.regret_tilt === "regret") {
      if (!stats.biggest_regret || r.weight > stats.biggest_regret.weight) {
        stats.biggest_regret = { id: r.id, spoken_date: r.spoken_date, weight: r.weight };
      }
    }
  }

  return NextResponse.json({ ok: true, almosts: rows ?? [], stats });
}
