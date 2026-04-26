// GET /api/self-erasures — list mined self-erasures.
//   ?status=pending|restored|released|noted|dismissed|pinned|archived|all (default pending)
//   ?kind=self_dismissal|cancellation|self_pathologising|minimisation|truncation|all (default all)
//   ?target=feeling|need|observation|request|opinion|memory|idea|complaint|unknown|all (default all)
//   ?domain=...|all (default all)
//   ?min_severity=1..5 (default 1)
//   ?min_confidence=1..5 (default 2)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "self_dismissal", "cancellation", "self_pathologising", "minimisation", "truncation",
]);
const VALID_TARGETS = new Set([
  "feeling", "need", "observation", "request", "opinion", "memory", "idea", "complaint", "unknown",
]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

const SELECT_COLS = "id, scan_id, erasure_text, erasure_kind, what_was_erased, what_was_erased_kind, censor_voice, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_with_target, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at";

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
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("self_erasures")
    .select(SELECT_COLS)
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "restored") q = q.eq("status", "restored");
  else if (status === "released") q = q.eq("status", "released");
  else if (status === "noted") q = q.eq("status", "noted");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (kind !== "all" && VALID_KINDS.has(kind)) q = q.eq("erasure_kind", kind);
  if (target !== "all" && VALID_TARGETS.has(target)) q = q.eq("what_was_erased_kind", target);
  if (domain !== "all" && VALID_DOMAINS.has(domain)) q = q.eq("domain", domain);
  if (minSeverity > 1) q = q.gte("pattern_severity", minSeverity);
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);

  q = q.order("pattern_severity", { ascending: false }).order("spoken_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statsRows } = await supabase
    .from("self_erasures")
    .select("status, archived_at, erasure_kind, what_was_erased_kind, domain, pattern_severity, recurrence_count, censor_voice")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    erasure_kind: string;
    what_was_erased_kind: string | null;
    domain: string;
    pattern_severity: number;
    recurrence_count: number;
    censor_voice: string | null;
  }>;
  const live = all.filter((r) => !r.archived_at);

  // Top censor voices — name the internal voices the user keeps overruling themselves with.
  const voiceMap = new Map<string, { rows: number; chronic: number; total_recurrence: number }>();
  for (const r of live) {
    const key = (r.censor_voice ?? "").toLowerCase().trim();
    if (!key) continue;
    const cur = voiceMap.get(key) ?? { rows: 0, chronic: 0, total_recurrence: 0 };
    cur.rows += 1;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.total_recurrence += r.recurrence_count;
    voiceMap.set(key, cur);
  }
  const voice_counts = Array.from(voiceMap.entries())
    .map(([voice, v]) => ({ voice, rows: v.rows, chronic_rows: v.chronic, total_recurrence: v.total_recurrence }))
    .sort((a, b) => b.total_recurrence - a.total_recurrence)
    .slice(0, 10);

  // What gets erased most — feelings? needs? requests?
  const targetMap = new Map<string, { rows: number; chronic: number; total_recurrence: number }>();
  for (const r of live) {
    const key = r.what_was_erased_kind ?? "unknown";
    const cur = targetMap.get(key) ?? { rows: 0, chronic: 0, total_recurrence: 0 };
    cur.rows += 1;
    if (r.pattern_severity >= 4) cur.chronic += 1;
    cur.total_recurrence += r.recurrence_count;
    targetMap.set(key, cur);
  }
  const target_counts = Array.from(targetMap.entries())
    .map(([target, v]) => ({ target, rows: v.rows, chronic_rows: v.chronic, total_recurrence: v.total_recurrence }))
    .sort((a, b) => b.total_recurrence - a.total_recurrence);

  const stats = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    restored: live.filter((r) => r.status === "restored").length,
    released: live.filter((r) => r.status === "released").length,
    noted: live.filter((r) => r.status === "noted").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    reflex_erasure: live.filter((r) => r.pattern_severity >= 4).length,
    pathologising: live.filter((r) => r.erasure_kind === "self_pathologising").length,
    cancelled_feelings: live.filter((r) => r.what_was_erased_kind === "feeling").length,
    cancelled_needs: live.filter((r) => r.what_was_erased_kind === "need").length,
    kind_counts: {
      self_dismissal: live.filter((r) => r.erasure_kind === "self_dismissal").length,
      cancellation: live.filter((r) => r.erasure_kind === "cancellation").length,
      self_pathologising: live.filter((r) => r.erasure_kind === "self_pathologising").length,
      minimisation: live.filter((r) => r.erasure_kind === "minimisation").length,
      truncation: live.filter((r) => r.erasure_kind === "truncation").length,
    },
    target_counts,
    voice_counts,
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
    erasures: data ?? [],
    stats,
  });
}
