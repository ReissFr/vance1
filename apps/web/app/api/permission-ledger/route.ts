// GET /api/permission-ledger — list mined permission-seekings.
//   ?status=pending|acknowledged|contested|granted|dismissed|pinned|archived|all (default pending)
//   ?kind=explicit_permission|justification|self_doubt|comparison_to_norm|future_excuse|all (default all)
//   ?authority=self_judge|partner|parent|professional_norm|social_norm|friend|work_authority|financial_judge|abstract_other|all (default all)
//   ?domain=...|all (default all)
//   ?min_severity=1..5 (default 1)
//   ?min_confidence=1..5 (default 2)
//   ?min_urgency=1..5 (default 1)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "explicit_permission", "justification", "self_doubt", "comparison_to_norm", "future_excuse",
]);
const VALID_AUTHORITIES = new Set([
  "self_judge", "partner", "parent", "professional_norm", "social_norm", "friend", "work_authority", "financial_judge", "abstract_other",
]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

const SELECT_COLS = "id, scan_id, request_text, request_kind, requested_action, action_aliases, implicit_authority, urgency_score, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const kind = url.searchParams.get("kind") ?? "all";
  const authority = url.searchParams.get("authority") ?? "all";
  const domain = url.searchParams.get("domain") ?? "all";
  const minSevRaw = parseInt(url.searchParams.get("min_severity") ?? "1", 10);
  const minSeverity = Math.max(1, Math.min(5, isNaN(minSevRaw) ? 1 : minSevRaw));
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const minUrgRaw = parseInt(url.searchParams.get("min_urgency") ?? "1", 10);
  const minUrgency = Math.max(1, Math.min(5, isNaN(minUrgRaw) ? 1 : minUrgRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("permission_seekings")
    .select(SELECT_COLS)
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("status", "acknowledged");
  else if (status === "contested") q = q.eq("status", "contested");
  else if (status === "granted") q = q.eq("status", "granted");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (kind !== "all" && VALID_KINDS.has(kind)) q = q.eq("request_kind", kind);
  if (authority !== "all" && VALID_AUTHORITIES.has(authority)) q = q.eq("implicit_authority", authority);
  if (domain !== "all" && VALID_DOMAINS.has(domain)) q = q.eq("domain", domain);
  if (minSeverity > 1) q = q.gte("pattern_severity", minSeverity);
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);
  if (minUrgency > 1) q = q.gte("urgency_score", minUrgency);

  q = q.order("pattern_severity", { ascending: false }).order("spoken_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statsRows } = await supabase
    .from("permission_seekings")
    .select("status, archived_at, request_kind, implicit_authority, domain, pattern_severity, urgency_score, requested_action, recurrence_count")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    request_kind: string;
    implicit_authority: string;
    domain: string;
    pattern_severity: number;
    urgency_score: number;
    requested_action: string;
    recurrence_count: number;
  }>;
  const live = all.filter((r) => !r.archived_at);

  // Top 8 chronic actions by max recurrence_count seen.
  const actionMap = new Map<string, { count: number; chronic: number; authorities: Set<string> }>();
  for (const r of live) {
    const key = (r.requested_action ?? "").toLowerCase().trim();
    if (!key) continue;
    const cur = actionMap.get(key) ?? { count: 0, chronic: 0, authorities: new Set<string>() };
    if (r.recurrence_count > cur.count) cur.count = r.recurrence_count;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.authorities.add(r.implicit_authority);
    actionMap.set(key, cur);
  }
  const action_counts = Array.from(actionMap.entries())
    .map(([action, v]) => ({ action, recurrence: v.count, chronic_rows: v.chronic, authorities: Array.from(v.authorities) }))
    .sort((a, b) => b.recurrence - a.recurrence)
    .slice(0, 8);

  // Top authorities — who the user is deferring to most.
  const authorityMap = new Map<string, { rows: number; chronic: number; total_recurrence: number }>();
  for (const r of live) {
    const key = r.implicit_authority;
    const cur = authorityMap.get(key) ?? { rows: 0, chronic: 0, total_recurrence: 0 };
    cur.rows += 1;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.total_recurrence += r.recurrence_count;
    authorityMap.set(key, cur);
  }
  const authority_counts = Array.from(authorityMap.entries())
    .map(([authority, v]) => ({ authority, rows: v.rows, chronic_rows: v.chronic, total_recurrence: v.total_recurrence }))
    .sort((a, b) => b.total_recurrence - a.total_recurrence);

  const stats = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    acknowledged: live.filter((r) => r.status === "acknowledged").length,
    contested: live.filter((r) => r.status === "contested").length,
    granted: live.filter((r) => r.status === "granted").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    chronic_seeking: live.filter((r) => r.pattern_severity >= 4).length,
    high_urgency: live.filter((r) => r.urgency_score >= 4).length,
    kind_counts: {
      explicit_permission: live.filter((r) => r.request_kind === "explicit_permission").length,
      justification: live.filter((r) => r.request_kind === "justification").length,
      self_doubt: live.filter((r) => r.request_kind === "self_doubt").length,
      comparison_to_norm: live.filter((r) => r.request_kind === "comparison_to_norm").length,
      future_excuse: live.filter((r) => r.request_kind === "future_excuse").length,
    },
    authority_counts,
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
    action_counts,
  };

  return NextResponse.json({
    seekings: data ?? [],
    stats,
  });
}
