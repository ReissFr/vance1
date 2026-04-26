// GET /api/used-to — list mined used-to statements.
//   ?status=pending|reclaimed|grieved|let_go|noted|dismissed|pinned|archived|all (default pending)
//   ?kind=hobby|habit|capability|relationship|place|identity|belief|role|ritual|all (default all)
//   ?target=activity|practice|trait|person_or_bond|location|self_concept|assumption|responsibility|rhythm|all (default all)
//   ?domain=...|all (default all)
//   ?min_severity=1..5 (default 1)
//   ?min_longing=1..5 (default 1)
//   ?min_confidence=1..5 (default 2)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "hobby", "habit", "capability", "relationship", "place", "identity", "belief", "role", "ritual",
]);
const VALID_TARGETS = new Set([
  "activity", "practice", "trait", "person_or_bond", "location", "self_concept", "assumption", "responsibility", "rhythm",
]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

const SELECT_COLS = "id, scan_id, used_to_text, used_to_kind, what_was, what_was_kind, longing_score, domain, spoken_date, message_id, conversation_id, recurrence_count, recurrence_days, recurrence_with_longing, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const kind = url.searchParams.get("kind") ?? "all";
  const target = url.searchParams.get("target") ?? "all";
  const domain = url.searchParams.get("domain") ?? "all";
  const minSevRaw = parseInt(url.searchParams.get("min_severity") ?? "1", 10);
  const minSeverity = Math.max(1, Math.min(5, isNaN(minSevRaw) ? 1 : minSevRaw));
  const minLongingRaw = parseInt(url.searchParams.get("min_longing") ?? "1", 10);
  const minLonging = Math.max(1, Math.min(5, isNaN(minLongingRaw) ? 1 : minLongingRaw));
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("used_to")
    .select(SELECT_COLS)
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "reclaimed") q = q.eq("status", "reclaimed");
  else if (status === "grieved") q = q.eq("status", "grieved");
  else if (status === "let_go") q = q.eq("status", "let_go");
  else if (status === "noted") q = q.eq("status", "noted");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (kind !== "all" && VALID_KINDS.has(kind)) q = q.eq("used_to_kind", kind);
  if (target !== "all" && VALID_TARGETS.has(target)) q = q.eq("what_was_kind", target);
  if (domain !== "all" && VALID_DOMAINS.has(domain)) q = q.eq("domain", domain);
  if (minSeverity > 1) q = q.gte("pattern_severity", minSeverity);
  if (minLonging > 1) q = q.gte("longing_score", minLonging);
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);

  q = q.order("longing_score", { ascending: false }).order("pattern_severity", { ascending: false }).order("spoken_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statsRows } = await supabase
    .from("used_to")
    .select("status, archived_at, used_to_kind, what_was_kind, domain, pattern_severity, longing_score, recurrence_count")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    used_to_kind: string;
    what_was_kind: string | null;
    domain: string;
    pattern_severity: number;
    longing_score: number;
    recurrence_count: number;
  }>;
  const live = all.filter((r) => !r.archived_at);

  // What kinds of past-self does the user keep mentioning most?
  const kindMap = new Map<string, { rows: number; chronic: number; total_recurrence: number; total_longing: number }>();
  for (const r of live) {
    const key = r.used_to_kind;
    const cur = kindMap.get(key) ?? { rows: 0, chronic: 0, total_recurrence: 0, total_longing: 0 };
    cur.rows += 1;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.total_recurrence += r.recurrence_count;
    cur.total_longing += r.longing_score;
    kindMap.set(key, cur);
  }
  const kind_counts_ranked = Array.from(kindMap.entries())
    .map(([k, v]) => ({ kind: k, rows: v.rows, chronic_rows: v.chronic, total_recurrence: v.total_recurrence, avg_longing: v.rows > 0 ? Math.round((v.total_longing / v.rows) * 10) / 10 : 0 }))
    .sort((a, b) => b.total_recurrence - a.total_recurrence);

  // What kinds of lost-thing — activity? practice? trait? person? location?
  const targetMap = new Map<string, { rows: number; chronic: number; total_recurrence: number; total_longing: number }>();
  for (const r of live) {
    const key = r.what_was_kind ?? "unknown";
    const cur = targetMap.get(key) ?? { rows: 0, chronic: 0, total_recurrence: 0, total_longing: 0 };
    cur.rows += 1;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.total_recurrence += r.recurrence_count;
    cur.total_longing += r.longing_score;
    targetMap.set(key, cur);
  }
  const target_counts = Array.from(targetMap.entries())
    .map(([t, v]) => ({ target: t, rows: v.rows, chronic_rows: v.chronic, total_recurrence: v.total_recurrence, avg_longing: v.rows > 0 ? Math.round((v.total_longing / v.rows) * 10) / 10 : 0 }))
    .sort((a, b) => b.total_recurrence - a.total_recurrence);

  const stats = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    reclaimed: live.filter((r) => r.status === "reclaimed").length,
    grieved: live.filter((r) => r.status === "grieved").length,
    let_go: live.filter((r) => r.status === "let_go").length,
    noted: live.filter((r) => r.status === "noted").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    chronic_mourning: live.filter((r) => r.pattern_severity >= 4).length,
    high_longing: live.filter((r) => r.longing_score >= 4).length,
    lost_hobbies: live.filter((r) => r.used_to_kind === "hobby").length,
    lost_relationships: live.filter((r) => r.used_to_kind === "relationship").length,
    lost_identities: live.filter((r) => r.used_to_kind === "identity").length,
    kind_counts: {
      hobby: live.filter((r) => r.used_to_kind === "hobby").length,
      habit: live.filter((r) => r.used_to_kind === "habit").length,
      capability: live.filter((r) => r.used_to_kind === "capability").length,
      relationship: live.filter((r) => r.used_to_kind === "relationship").length,
      place: live.filter((r) => r.used_to_kind === "place").length,
      identity: live.filter((r) => r.used_to_kind === "identity").length,
      belief: live.filter((r) => r.used_to_kind === "belief").length,
      role: live.filter((r) => r.used_to_kind === "role").length,
      ritual: live.filter((r) => r.used_to_kind === "ritual").length,
    },
    kind_counts_ranked,
    target_counts,
    domain_counts: {
      work: live.filter((r) => r.domain === "work").length,
      relationships: live.filter((r) => r.domain === "relationships").length,
      health: live.filter((r) => r.domain === "health").length,
      identity: live.filter((r) => r.domain === "identity").length,
      finance: live.filter((r) => r.domain === "finance").length,
      creative: live.filter((r) => r.domain === "creative").length,
      learning: live.filter((r) => r.domain === "learning").length,
      daily: live.filter((r) => r.domain === "daily").length,
      other: live.filter((r) => r.domain === "other").length,
    },
  };

  return NextResponse.json({
    used_tos: data ?? [],
    stats,
  });
}
