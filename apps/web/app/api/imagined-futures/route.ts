// GET /api/imagined-futures — list imagined futures (§171) with stats.
//
// Query: ?status=active|pursuing|released|sitting_with|grieved|dismissed|pinned|archived|all (default active)
//        ?pull_kind=seeking|escaping|grieving|entertaining|all
//        ?domain=...|all
//        ?min_weight=1-5
//        ?min_confidence=1-5
//        ?limit=N (default 80, max 300)

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_PULL_KINDS = new Set(["seeking", "escaping", "grieving", "entertaining"]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);
const VALID_STATUSES = new Set([
  "active", "pursuing", "released", "sitting_with", "grieved", "dismissed",
]);

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status") ?? "active";
  const pullKindRaw = searchParams.get("pull_kind") ?? "all";
  const domainRaw = searchParams.get("domain") ?? "all";
  const minWeightRaw = parseInt(searchParams.get("min_weight") ?? "1", 10);
  const minConfRaw = parseInt(searchParams.get("min_confidence") ?? "2", 10);
  const limitRaw = parseInt(searchParams.get("limit") ?? "80", 10);

  const minWeight = Number.isFinite(minWeightRaw) ? Math.max(1, Math.min(5, minWeightRaw)) : 1;
  const minConf = Number.isFinite(minConfRaw) ? Math.max(1, Math.min(5, minConfRaw)) : 2;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, limitRaw)) : 80;

  let query = supabase
    .from("imagined_futures")
    .select("id, scan_id, act_text, future_state, pull_kind, domain, weight, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, pursue_intention_id, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
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

  if (pullKindRaw !== "all") {
    if (!VALID_PULL_KINDS.has(pullKindRaw)) return NextResponse.json({ error: "invalid pull_kind" }, { status: 400 });
    query = query.eq("pull_kind", pullKindRaw);
  }

  if (domainRaw !== "all") {
    if (!VALID_DOMAINS.has(domainRaw)) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
    query = query.eq("domain", domainRaw);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    pull_kind: string;
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
    pursuing: 0,
    released: 0,
    sitting_with: 0,
    grieved: 0,
    dismissed: 0,
    pinned: 0,
    seeking: 0,
    escaping: 0,
    grieving: 0,
    entertaining: 0,
    high_weight: 0,
    seeking_active: 0,
    escaping_active: 0,
    grieving_active: 0,
    seeking_pursued: 0,
    grieving_grieved: 0,
    pull_kind_counts: {} as Record<string, number>,
    domain_counts: {} as Record<string, number>,
    kind_by_domain: {} as Record<string, { seeking: number; escaping: number; grieving: number; entertaining: number }>,
    biggest_seeking: null as null | { id: string; spoken_date: string; weight: number },
    biggest_escaping: null as null | { id: string; spoken_date: string; weight: number },
    most_recent_grieving: null as null | { id: string; spoken_date: string },
    most_recent_seeking: null as null | { id: string; spoken_date: string },
  };

  for (const r of all) {
    if (r.status === "active") stats.active++;
    else if (r.status === "pursuing") stats.pursuing++;
    else if (r.status === "released") stats.released++;
    else if (r.status === "sitting_with") stats.sitting_with++;
    else if (r.status === "grieved") stats.grieved++;
    else if (r.status === "dismissed") stats.dismissed++;
    if (r.pinned) stats.pinned++;
    if (r.pull_kind === "seeking") stats.seeking++;
    else if (r.pull_kind === "escaping") stats.escaping++;
    else if (r.pull_kind === "grieving") stats.grieving++;
    else if (r.pull_kind === "entertaining") stats.entertaining++;
    if (r.weight >= 4) stats.high_weight++;
    if (r.pull_kind === "seeking" && r.status === "active") stats.seeking_active++;
    if (r.pull_kind === "escaping" && r.status === "active") stats.escaping_active++;
    if (r.pull_kind === "grieving" && r.status === "active") stats.grieving_active++;
    if (r.pull_kind === "seeking" && r.status === "pursuing") stats.seeking_pursued++;
    if (r.pull_kind === "grieving" && r.status === "grieved") stats.grieving_grieved++;
    stats.pull_kind_counts[r.pull_kind] = (stats.pull_kind_counts[r.pull_kind] ?? 0) + 1;
    stats.domain_counts[r.domain] = (stats.domain_counts[r.domain] ?? 0) + 1;
    if (!stats.kind_by_domain[r.domain]) {
      stats.kind_by_domain[r.domain] = { seeking: 0, escaping: 0, grieving: 0, entertaining: 0 };
    }
    const domainBucket = stats.kind_by_domain[r.domain];
    if (domainBucket && (r.pull_kind === "seeking" || r.pull_kind === "escaping" || r.pull_kind === "grieving" || r.pull_kind === "entertaining")) {
      domainBucket[r.pull_kind as "seeking" | "escaping" | "grieving" | "entertaining"]++;
    }
    if (r.pull_kind === "seeking") {
      if (!stats.biggest_seeking || r.weight > stats.biggest_seeking.weight) {
        stats.biggest_seeking = { id: r.id, spoken_date: r.spoken_date, weight: r.weight };
      }
      if (!stats.most_recent_seeking || r.spoken_date > stats.most_recent_seeking.spoken_date) {
        stats.most_recent_seeking = { id: r.id, spoken_date: r.spoken_date };
      }
    }
    if (r.pull_kind === "escaping") {
      if (!stats.biggest_escaping || r.weight > stats.biggest_escaping.weight) {
        stats.biggest_escaping = { id: r.id, spoken_date: r.spoken_date, weight: r.weight };
      }
    }
    if (r.pull_kind === "grieving" && r.status === "active") {
      if (!stats.most_recent_grieving || r.spoken_date > stats.most_recent_grieving.spoken_date) {
        stats.most_recent_grieving = { id: r.id, spoken_date: r.spoken_date };
      }
    }
  }

  return NextResponse.json({ ok: true, imagined_futures: rows ?? [], stats });
}
