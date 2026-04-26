// GET /api/shoulds — list mined should statements (§166).
//   ?status=pending|done|released|converted|noted|dismissed|pinned|archived|all (default pending)
//   ?kind=moral|practical|social|relational|health|identity|work|financial|all (default all)
//   ?source=self|parent|partner|inner_critic|social_norm|professional_norm|financial_judge|abstract_other|all (default all)
//   ?domain=...|all (default all)
//   ?min_severity=1..5 (default 1)
//   ?min_charge=1..5 (default 1)
//   ?min_confidence=1..5 (default 2)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "moral", "practical", "social", "relational", "health", "identity", "work", "financial",
]);
const VALID_SOURCES = new Set([
  "self", "parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "abstract_other",
]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

const SELECT_COLS = "id, scan_id, should_text, should_kind, distilled_obligation, obligation_source, charge_score, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_with_charge, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const kind = url.searchParams.get("kind") ?? "all";
  const source = url.searchParams.get("source") ?? "all";
  const domain = url.searchParams.get("domain") ?? "all";
  const minSevRaw = parseInt(url.searchParams.get("min_severity") ?? "1", 10);
  const minSeverity = Math.max(1, Math.min(5, isNaN(minSevRaw) ? 1 : minSevRaw));
  const minChargeRaw = parseInt(url.searchParams.get("min_charge") ?? "1", 10);
  const minCharge = Math.max(1, Math.min(5, isNaN(minChargeRaw) ? 1 : minChargeRaw));
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("shoulds")
    .select(SELECT_COLS)
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "done") q = q.eq("status", "done");
  else if (status === "released") q = q.eq("status", "released");
  else if (status === "converted") q = q.eq("status", "converted");
  else if (status === "noted") q = q.eq("status", "noted");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (kind !== "all" && VALID_KINDS.has(kind)) q = q.eq("should_kind", kind);
  if (source !== "all" && VALID_SOURCES.has(source)) q = q.eq("obligation_source", source);
  if (domain !== "all" && VALID_DOMAINS.has(domain)) q = q.eq("domain", domain);
  if (minSeverity > 1) q = q.gte("pattern_severity", minSeverity);
  if (minCharge > 1) q = q.gte("charge_score", minCharge);
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);

  q = q.order("charge_score", { ascending: false }).order("pattern_severity", { ascending: false }).order("spoken_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statsRows } = await supabase
    .from("shoulds")
    .select("status, archived_at, should_kind, obligation_source, domain, pattern_severity, charge_score, recurrence_count")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    should_kind: string;
    obligation_source: string;
    domain: string;
    pattern_severity: number;
    charge_score: number;
    recurrence_count: number;
  }>;
  const live = all.filter((r) => !r.archived_at);

  // Whose voice put these shoulds there? Diagnostic surface.
  const sourceMap = new Map<string, { rows: number; chronic: number; total_recurrence: number; total_charge: number }>();
  for (const r of live) {
    const key = r.obligation_source;
    const cur = sourceMap.get(key) ?? { rows: 0, chronic: 0, total_recurrence: 0, total_charge: 0 };
    cur.rows += 1;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.total_recurrence += r.recurrence_count;
    cur.total_charge += r.charge_score;
    sourceMap.set(key, cur);
  }
  const source_counts_ranked = Array.from(sourceMap.entries())
    .map(([s, v]) => ({ source: s, rows: v.rows, chronic_rows: v.chronic, total_recurrence: v.total_recurrence, avg_charge: v.rows > 0 ? Math.round((v.total_charge / v.rows) * 10) / 10 : 0 }))
    .sort((a, b) => b.total_recurrence - a.total_recurrence);

  // What kinds of obligation does the user carry most?
  const kindMap = new Map<string, { rows: number; chronic: number; total_recurrence: number; total_charge: number }>();
  for (const r of live) {
    const key = r.should_kind;
    const cur = kindMap.get(key) ?? { rows: 0, chronic: 0, total_recurrence: 0, total_charge: 0 };
    cur.rows += 1;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.total_recurrence += r.recurrence_count;
    cur.total_charge += r.charge_score;
    kindMap.set(key, cur);
  }
  const kind_counts_ranked = Array.from(kindMap.entries())
    .map(([k, v]) => ({ kind: k, rows: v.rows, chronic_rows: v.chronic, total_recurrence: v.total_recurrence, avg_charge: v.rows > 0 ? Math.round((v.total_charge / v.rows) * 10) / 10 : 0 }))
    .sort((a, b) => b.total_recurrence - a.total_recurrence);

  const stats = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    done: live.filter((r) => r.status === "done").length,
    released: live.filter((r) => r.status === "released").length,
    converted: live.filter((r) => r.status === "converted").length,
    noted: live.filter((r) => r.status === "noted").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    chronic_should: live.filter((r) => r.pattern_severity >= 4).length,
    high_charge: live.filter((r) => r.charge_score >= 4).length,
    inner_critic_count: live.filter((r) => r.obligation_source === "inner_critic").length,
    parent_count: live.filter((r) => r.obligation_source === "parent").length,
    self_count: live.filter((r) => r.obligation_source === "self").length,
    source_counts_ranked,
    kind_counts_ranked,
    kind_counts: {
      moral: live.filter((r) => r.should_kind === "moral").length,
      practical: live.filter((r) => r.should_kind === "practical").length,
      social: live.filter((r) => r.should_kind === "social").length,
      relational: live.filter((r) => r.should_kind === "relational").length,
      health: live.filter((r) => r.should_kind === "health").length,
      identity: live.filter((r) => r.should_kind === "identity").length,
      work: live.filter((r) => r.should_kind === "work").length,
      financial: live.filter((r) => r.should_kind === "financial").length,
    },
    source_counts: {
      self: live.filter((r) => r.obligation_source === "self").length,
      parent: live.filter((r) => r.obligation_source === "parent").length,
      partner: live.filter((r) => r.obligation_source === "partner").length,
      inner_critic: live.filter((r) => r.obligation_source === "inner_critic").length,
      social_norm: live.filter((r) => r.obligation_source === "social_norm").length,
      professional_norm: live.filter((r) => r.obligation_source === "professional_norm").length,
      financial_judge: live.filter((r) => r.obligation_source === "financial_judge").length,
      abstract_other: live.filter((r) => r.obligation_source === "abstract_other").length,
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
  };

  return NextResponse.json({
    shoulds: data ?? [],
    stats,
  });
}
