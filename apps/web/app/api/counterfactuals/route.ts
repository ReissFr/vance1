// GET /api/counterfactuals — list counterfactuals.
// Query: ?decision_id=…&verdict=regret_taken_path|validated_taken_path|neutral|unsure|all

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const decisionId = url.searchParams.get("decision_id");
  const verdict = url.searchParams.get("verdict");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50;

  let q = supabase
    .from("counterfactuals")
    .select("id, decision_id, alternative_choice, body, credibility, user_note, verdict, created_at, decisions(id, title, choice, created_at)")
    .eq("user_id", user.id);
  if (decisionId) q = q.eq("decision_id", decisionId);
  if (verdict && ["regret_taken_path", "validated_taken_path", "neutral", "unsure"].includes(verdict)) {
    q = q.eq("verdict", verdict);
  }
  q = q.order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ counterfactuals: data ?? [] });
}
