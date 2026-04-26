// GET /api/mind-theatre — list Mind Theatre sessions (§168).
//
// Query: ?outcome=unresolved|went_with_voice|self_authored|silenced_voice
//        ?include_archived=1
//        ?limit=N (default 50, max 200)

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_OUTCOMES = new Set([
  "unresolved",
  "went_with_voice",
  "self_authored",
  "silenced_voice",
]);

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const outcome = searchParams.get("outcome");
  const includeArchived = searchParams.get("include_archived") === "1";
  const limitRaw = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  let query = supabase
    .from("mind_theatre_sessions")
    .select("id, question, context_note, panel, voices_consulted, dominant_stance, outcome, chosen_voice_id, silenced_voice_id, self_authored_answer, decision_note, latency_ms, model, created_at, resolved_at, archived_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeArchived) {
    query = query.is("archived_at", null);
  }
  if (outcome && VALID_OUTCOMES.has(outcome)) {
    query = query.eq("outcome", outcome);
  }

  const { data: sessions, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type SessionRow = { outcome: string; voices_consulted: number; chosen_voice_id: string | null; silenced_voice_id: string | null };
  const rows = (sessions ?? []) as SessionRow[];

  const stats = {
    total: rows.length,
    unresolved: 0,
    went_with_voice: 0,
    self_authored: 0,
    silenced_voice: 0,
    total_voices_consulted: 0,
  };
  const chosenCounts = new Map<string, number>();
  const silencedCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.outcome === "unresolved") stats.unresolved++;
    else if (r.outcome === "went_with_voice") stats.went_with_voice++;
    else if (r.outcome === "self_authored") stats.self_authored++;
    else if (r.outcome === "silenced_voice") stats.silenced_voice++;
    stats.total_voices_consulted += r.voices_consulted ?? 0;
    if (r.chosen_voice_id) chosenCounts.set(r.chosen_voice_id, (chosenCounts.get(r.chosen_voice_id) ?? 0) + 1);
    if (r.silenced_voice_id) silencedCounts.set(r.silenced_voice_id, (silencedCounts.get(r.silenced_voice_id) ?? 0) + 1);
  }

  const top_chosen = Array.from(chosenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([voice_id, count]) => ({ voice_id, count }));
  const top_silenced = Array.from(silencedCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([voice_id, count]) => ({ voice_id, count }));

  return NextResponse.json({
    ok: true,
    sessions: sessions ?? [],
    stats: { ...stats, top_chosen, top_silenced },
  });
}
