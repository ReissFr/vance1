// GET /api/cabinet — list voices in the user's voice cabinet (§167).
//   ?status=active|acknowledged|integrating|retired|dismissed|pinned|archived|all (default active)
//   ?type=parent|partner|inner_critic|social_norm|professional_norm|financial_judge|past_self|future_self|mentor|abstract_other|all (default all)
//   ?min_severity=1..5 (default 1)
//   ?min_confidence=1..5 (default 2)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_TYPES = new Set([
  "parent", "partner", "inner_critic", "social_norm",
  "professional_norm", "financial_judge", "past_self",
  "future_self", "mentor", "abstract_other",
]);

const SELECT_COLS = "id, scan_id, voice_name, voice_type, voice_relation, typical_phrases, typical_obligations, typical_kinds, typical_domains, airtime_score, influence_severity, charge_average, shoulds_attributed, used_to_linked, inheritance_mentions, first_detected_at, last_detected_at, detection_span_days, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "active";
  const type = url.searchParams.get("type") ?? "all";
  const minSevRaw = parseInt(url.searchParams.get("min_severity") ?? "1", 10);
  const minSeverity = Math.max(1, Math.min(5, isNaN(minSevRaw) ? 1 : minSevRaw));
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("voice_cabinet")
    .select(SELECT_COLS)
    .eq("user_id", user.id);

  if (status === "active") q = q.eq("status", "active").is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("status", "acknowledged");
  else if (status === "integrating") q = q.eq("status", "integrating");
  else if (status === "retired") q = q.eq("status", "retired");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);

  if (type !== "all" && VALID_TYPES.has(type)) q = q.eq("voice_type", type);
  if (minSeverity > 1) q = q.gte("influence_severity", minSeverity);
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);

  q = q
    .order("airtime_score", { ascending: false })
    .order("influence_severity", { ascending: false })
    .order("last_detected_at", { ascending: false })
    .limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statsRows } = await supabase
    .from("voice_cabinet")
    .select("status, archived_at, voice_type, airtime_score, influence_severity, charge_average, shoulds_attributed")
    .eq("user_id", user.id);

  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    voice_type: string;
    airtime_score: number;
    influence_severity: number;
    charge_average: number | null;
    shoulds_attributed: number;
  }>;
  const live = all.filter((r) => !r.archived_at);

  const typeMap = new Map<string, { rows: number; airtime: number; max_severity: number }>();
  for (const r of live) {
    const cur = typeMap.get(r.voice_type) ?? { rows: 0, airtime: 0, max_severity: 0 };
    cur.rows += 1;
    cur.airtime += r.airtime_score;
    if (r.influence_severity > cur.max_severity) cur.max_severity = r.influence_severity;
    typeMap.set(r.voice_type, cur);
  }
  const type_counts_ranked = Array.from(typeMap.entries())
    .map(([t, v]) => ({ voice_type: t, rows: v.rows, airtime: v.airtime, max_severity: v.max_severity }))
    .sort((a, b) => b.airtime - a.airtime);

  const dominant = live.length > 0
    ? live.slice().sort((a, b) => b.airtime_score - a.airtime_score)[0]
    : null;
  const most_severe = live.length > 0
    ? live.slice().sort((a, b) => b.influence_severity - a.influence_severity || b.airtime_score - a.airtime_score)[0]
    : null;

  const stats = {
    total: live.length,
    active: live.filter((r) => r.status === "active").length,
    acknowledged: live.filter((r) => r.status === "acknowledged").length,
    integrating: live.filter((r) => r.status === "integrating").length,
    retired: live.filter((r) => r.status === "retired").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    high_severity: live.filter((r) => r.influence_severity >= 4).length,
    inner_critic_active: live.filter((r) => r.voice_type === "inner_critic" && r.status === "active").length,
    parent_active: live.filter((r) => r.voice_type === "parent" && r.status === "active").length,
    total_airtime: live.reduce((acc, r) => acc + r.airtime_score, 0),
    type_counts_ranked,
    dominant_voice: dominant ? { airtime: dominant.airtime_score, severity: dominant.influence_severity, voice_type: dominant.voice_type } : null,
    most_severe_voice: most_severe ? { airtime: most_severe.airtime_score, severity: most_severe.influence_severity, voice_type: most_severe.voice_type } : null,
  };

  return NextResponse.json({
    voices: data ?? [],
    stats,
  });
}
