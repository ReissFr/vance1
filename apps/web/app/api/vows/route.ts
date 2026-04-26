// GET /api/vows — list vows (§172) with stats.
//
// Query: ?status=active|renewed|revised|released|honoured|dismissed|pinned|archived|all (default active)
//        ?vow_age=childhood|adolescent|early_adult|adult|recent|unknown|all
//        ?domain=...|all
//        ?min_weight=1-5
//        ?min_confidence=1-5
//        ?limit=N (default 80, max 300)

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_VOW_AGES = new Set(["childhood", "adolescent", "early_adult", "adult", "recent", "unknown"]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);
const VALID_STATUSES = new Set([
  "active", "renewed", "revised", "released", "honoured", "dismissed",
]);

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status") ?? "active";
  const vowAgeRaw = searchParams.get("vow_age") ?? "all";
  const domainRaw = searchParams.get("domain") ?? "all";
  const minWeightRaw = parseInt(searchParams.get("min_weight") ?? "1", 10);
  const minConfRaw = parseInt(searchParams.get("min_confidence") ?? "2", 10);
  const limitRaw = parseInt(searchParams.get("limit") ?? "80", 10);

  const minWeight = Number.isFinite(minWeightRaw) ? Math.max(1, Math.min(5, minWeightRaw)) : 1;
  const minConf = Number.isFinite(minConfRaw) ? Math.max(1, Math.min(5, minConfRaw)) : 2;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, limitRaw)) : 80;

  let query = supabase
    .from("vows")
    .select("id, scan_id, vow_text, shadow, origin_event, vow_age, domain, weight, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, revised_to, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
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

  if (vowAgeRaw !== "all") {
    if (!VALID_VOW_AGES.has(vowAgeRaw)) return NextResponse.json({ error: "invalid vow_age" }, { status: 400 });
    query = query.eq("vow_age", vowAgeRaw);
  }

  if (domainRaw !== "all") {
    if (!VALID_DOMAINS.has(domainRaw)) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
    query = query.eq("domain", domainRaw);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    vow_age: string;
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
    renewed: 0,
    revised: 0,
    released: 0,
    honoured: 0,
    dismissed: 0,
    pinned: 0,
    childhood: 0,
    adolescent: 0,
    early_adult: 0,
    adult: 0,
    recent: 0,
    unknown_age: 0,
    high_weight: 0,
    organizing_principles: 0,
    unexamined_childhood: 0,
    unexamined_adolescent: 0,
    revised_count: 0,
    released_count: 0,
    vow_age_counts: {} as Record<string, number>,
    domain_counts: {} as Record<string, number>,
    age_by_domain: {} as Record<string, { childhood: number; adolescent: number; early_adult: number; adult: number; recent: number; unknown: number }>,
    biggest_active: null as null | { id: string; spoken_date: string; weight: number },
    oldest_unexamined: null as null | { id: string; vow_age: string; weight: number },
    most_recent_released: null as null | { id: string; spoken_date: string },
  };

  for (const r of all) {
    if (r.status === "active") stats.active++;
    else if (r.status === "renewed") stats.renewed++;
    else if (r.status === "revised") { stats.revised++; stats.revised_count++; }
    else if (r.status === "released") { stats.released++; stats.released_count++; }
    else if (r.status === "honoured") stats.honoured++;
    else if (r.status === "dismissed") stats.dismissed++;
    if (r.pinned) stats.pinned++;
    if (r.vow_age === "childhood") stats.childhood++;
    else if (r.vow_age === "adolescent") stats.adolescent++;
    else if (r.vow_age === "early_adult") stats.early_adult++;
    else if (r.vow_age === "adult") stats.adult++;
    else if (r.vow_age === "recent") stats.recent++;
    else if (r.vow_age === "unknown") stats.unknown_age++;
    if (r.weight >= 4) stats.high_weight++;
    if (r.weight === 5) stats.organizing_principles++;
    if (r.vow_age === "childhood" && r.status === "active") stats.unexamined_childhood++;
    if (r.vow_age === "adolescent" && r.status === "active") stats.unexamined_adolescent++;
    stats.vow_age_counts[r.vow_age] = (stats.vow_age_counts[r.vow_age] ?? 0) + 1;
    stats.domain_counts[r.domain] = (stats.domain_counts[r.domain] ?? 0) + 1;
    if (!stats.age_by_domain[r.domain]) {
      stats.age_by_domain[r.domain] = { childhood: 0, adolescent: 0, early_adult: 0, adult: 0, recent: 0, unknown: 0 };
    }
    const ageBucket = stats.age_by_domain[r.domain];
    if (ageBucket) {
      const key = (r.vow_age === "unknown" ? "unknown" : r.vow_age) as "childhood" | "adolescent" | "early_adult" | "adult" | "recent" | "unknown";
      ageBucket[key]++;
    }
    if (r.status === "active") {
      if (!stats.biggest_active || r.weight > stats.biggest_active.weight) {
        stats.biggest_active = { id: r.id, spoken_date: r.spoken_date, weight: r.weight };
      }
      if ((r.vow_age === "childhood" || r.vow_age === "adolescent") && r.weight >= 3) {
        if (!stats.oldest_unexamined || r.weight > stats.oldest_unexamined.weight) {
          stats.oldest_unexamined = { id: r.id, vow_age: r.vow_age, weight: r.weight };
        }
      }
    }
    if (r.status === "released") {
      if (!stats.most_recent_released || r.spoken_date > stats.most_recent_released.spoken_date) {
        stats.most_recent_released = { id: r.id, spoken_date: r.spoken_date };
      }
    }
  }

  return NextResponse.json({ ok: true, vows: rows ?? [], stats });
}
