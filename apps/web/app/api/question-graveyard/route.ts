// GET /api/question-graveyard — list buried questions.
//   ?status=pending|acknowledged|answered|contested|dismissed|pinned|archived|all (default pending)
//   ?answered=any|true|false (default any)
//   ?kind=decision|self_inquiry|meta|factual|hypothetical|rhetorical|all (default all)
//   ?domain=...|all (default all)
//   ?min_neglect=1..5 (default 1)
//   ?min_confidence=1..5 (default 2)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "decision", "self_inquiry", "meta", "factual", "hypothetical", "rhetorical",
]);
const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const answeredFilter = url.searchParams.get("answered") ?? "any";
  const kind = url.searchParams.get("kind") ?? "all";
  const domain = url.searchParams.get("domain") ?? "all";
  const minNeglectRaw = parseInt(url.searchParams.get("min_neglect") ?? "1", 10);
  const minNeglect = Math.max(1, Math.min(5, isNaN(minNeglectRaw) ? 1 : minNeglectRaw));
  const minConfRaw = parseInt(url.searchParams.get("min_confidence") ?? "2", 10);
  const minConfidence = Math.max(1, Math.min(5, isNaN(minConfRaw) ? 2 : minConfRaw));
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("question_graveyard")
    .select("id, scan_id, question_text, question_kind, needs_answer, domain, asked_date, asked_message_id, asked_conversation_id, topic_aliases, days_since_asked, asked_again_count, asked_again_days, answered, answer_text, answer_date, answer_message_id, days_to_answer, proposed_answer_excerpts, neglect_score, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (status === "pending") q = q.eq("status", "pending").is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("status", "acknowledged");
  else if (status === "answered") q = q.eq("status", "answered");
  else if (status === "contested") q = q.eq("status", "contested");
  else if (status === "dismissed") q = q.eq("status", "dismissed");
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  if (answeredFilter === "true") q = q.eq("answered", true);
  else if (answeredFilter === "false") q = q.eq("answered", false);

  if (kind !== "all" && VALID_KINDS.has(kind)) {
    q = q.eq("question_kind", kind);
  }
  if (domain !== "all" && VALID_DOMAINS.has(domain)) {
    q = q.eq("domain", domain);
  }
  if (minNeglect > 1) q = q.gte("neglect_score", minNeglect);
  if (minConfidence > 1) q = q.gte("confidence", minConfidence);

  q = q.order("neglect_score", { ascending: false }).order("asked_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statsRows } = await supabase
    .from("question_graveyard")
    .select("status, archived_at, answered, needs_answer, neglect_score, question_kind, domain")
    .eq("user_id", user.id);
  const all = (statsRows ?? []) as Array<{
    status: string;
    archived_at: string | null;
    answered: boolean;
    needs_answer: boolean;
    neglect_score: number;
    question_kind: string;
    domain: string;
  }>;
  const live = all.filter((r) => !r.archived_at);
  const stats = {
    total: live.length,
    pending: live.filter((r) => r.status === "pending").length,
    acknowledged: live.filter((r) => r.status === "acknowledged").length,
    answered: live.filter((r) => r.status === "answered").length,
    contested: live.filter((r) => r.status === "contested").length,
    dismissed: live.filter((r) => r.status === "dismissed").length,
    unanswered: live.filter((r) => r.needs_answer && !r.answered).length,
    severely_neglected: live.filter((r) => r.needs_answer && !r.answered && r.neglect_score >= 5).length,
    strongly_neglected: live.filter((r) => r.needs_answer && !r.answered && r.neglect_score >= 4).length,
    kind_counts: {
      decision: live.filter((r) => r.question_kind === "decision").length,
      self_inquiry: live.filter((r) => r.question_kind === "self_inquiry").length,
      meta: live.filter((r) => r.question_kind === "meta").length,
      factual: live.filter((r) => r.question_kind === "factual").length,
      hypothetical: live.filter((r) => r.question_kind === "hypothetical").length,
      rhetorical: live.filter((r) => r.question_kind === "rhetorical").length,
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
    questions: data ?? [],
    stats,
  });
}
