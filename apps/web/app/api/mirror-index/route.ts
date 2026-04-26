// GET /api/mirror-index — list mined comparisons.
//   ?status=pending|acknowledged|contested|reframed|dismissed|pinned|archived|all (default pending)
//   ?kind=past_self|peer|sibling_or_parent|ideal_self|imagined_future_self|downward|all (default all)
//   ?position=below|equal|above|aspiring|all (default all)
//   ?valence=lifting|neutral|punishing|all (default all)
//   ?domain=...|all (default all)
//   ?min_severity=1..5 (default 1)
//   ?min_confidence=1..5 (default 2)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "past_self", "peer", "sibling_or_parent", "ideal_self", "imagined_future_self", "downward",
]);
const VALID_POSITIONS = new Set(["below", "equal", "above", "aspiring"]);
const VALID_VALENCES = new Set(["lifting", "neutral", "punishing"]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

const SELECT_COLS = "id, scan_id, comparison_text, comparison_kind, comparison_target, target_aliases, self_position, fairness_score, valence, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const kind = url.searchParams.get("kind") ?? "all";
  const position = url.searchParams.get("position") ?? "all";
  const valence = url.searchParams.get("valence") ?? "all";
  const domain = url.searchParams.get("domain") ?? "all";
  const minSevRaw = parseInt(url.searchParams.get("min_severity") ?? "1", 10);
  const minSeverity = Math.max(1, Math.min(5, isNaN(minSevRaw) ? 1 : minSevRaw));
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("mirror_comparisons")
    .select(SELECT_COLS)
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("status", "acknowledged");
  else if (status === "contested") q = q.eq("status", "contested");
  else if (status === "reframed") q = q.eq("status", "reframed");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (kind !== "all" && VALID_KINDS.has(kind)) q = q.eq("comparison_kind", kind);
  if (position !== "all" && VALID_POSITIONS.has(position)) q = q.eq("self_position", position);
  if (valence !== "all" && VALID_VALENCES.has(valence)) q = q.eq("valence", valence);
  if (domain !== "all" && VALID_DOMAINS.has(domain)) q = q.eq("domain", domain);
  if (minSeverity > 1) q = q.gte("pattern_severity", minSeverity);
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);

  q = q.order("pattern_severity", { ascending: false }).order("spoken_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statsRows } = await supabase
    .from("mirror_comparisons")
    .select("status, archived_at, comparison_kind, self_position, valence, domain, pattern_severity, fairness_score, comparison_target, recurrence_count")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    comparison_kind: string;
    self_position: string;
    valence: string;
    domain: string;
    pattern_severity: number;
    fairness_score: number;
    comparison_target: string;
    recurrence_count: number;
  }>;
  const live = all.filter((r) => !r.archived_at);

  // Top 8 chronic comparison targets by max recurrence_count seen.
  // Same target appearing in multiple scan rows — take the highest recurrence
  // count (latest scan usually has the largest window count).
  const targetMap = new Map<string, { count: number; punishing: number }>();
  for (const r of live) {
    const key = (r.comparison_target ?? "").toLowerCase().trim();
    if (!key) continue;
    const cur = targetMap.get(key) ?? { count: 0, punishing: 0 };
    if (r.recurrence_count > cur.count) cur.count = r.recurrence_count;
    if (r.valence === "punishing" && r.self_position === "below") cur.punishing += 1;
    targetMap.set(key, cur);
  }
  const target_counts = Array.from(targetMap.entries())
    .map(([target, v]) => ({ target, recurrence: v.count, punishing_rows: v.punishing }))
    .sort((a, b) => b.recurrence - a.recurrence)
    .slice(0, 8);

  const stats = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    acknowledged: live.filter((r) => r.status === "acknowledged").length,
    contested: live.filter((r) => r.status === "contested").length,
    reframed: live.filter((r) => r.status === "reframed").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    severely_punishing: live.filter((r) =>
      r.pattern_severity >= 4 && r.valence === "punishing" && r.self_position === "below"
    ).length,
    chronic_unfair: live.filter((r) =>
      r.pattern_severity >= 4 && r.fairness_score <= 2
    ).length,
    kind_counts: {
      past_self: live.filter((r) => r.comparison_kind === "past_self").length,
      peer: live.filter((r) => r.comparison_kind === "peer").length,
      sibling_or_parent: live.filter((r) => r.comparison_kind === "sibling_or_parent").length,
      ideal_self: live.filter((r) => r.comparison_kind === "ideal_self").length,
      imagined_future_self: live.filter((r) => r.comparison_kind === "imagined_future_self").length,
      downward: live.filter((r) => r.comparison_kind === "downward").length,
    },
    position_counts: {
      below: live.filter((r) => r.self_position === "below").length,
      equal: live.filter((r) => r.self_position === "equal").length,
      above: live.filter((r) => r.self_position === "above").length,
      aspiring: live.filter((r) => r.self_position === "aspiring").length,
    },
    valence_counts: {
      lifting: live.filter((r) => r.valence === "lifting").length,
      neutral: live.filter((r) => r.valence === "neutral").length,
      punishing: live.filter((r) => r.valence === "punishing").length,
    },
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
    target_counts,
  };

  return NextResponse.json({
    comparisons: data ?? [],
    stats,
  });
}
