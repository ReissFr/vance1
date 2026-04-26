// PATCH /api/counterfactuals/[id]
//   { user_note: string }
//   { verdict: 'regret_taken_path'|'validated_taken_path'|'neutral'|'unsure' }
// DELETE /api/counterfactuals/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_VERDICT = new Set(["regret_taken_path", "validated_taken_path", "neutral", "unsure"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { user_note?: string; verdict?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.user_note === "string") {
    const t = body.user_note.trim();
    update.user_note = t.length > 0 ? t.slice(0, 1000) : null;
  }
  if (body.verdict) {
    if (!VALID_VERDICT.has(body.verdict)) return NextResponse.json({ error: "invalid verdict" }, { status: 400 });
    update.verdict = body.verdict;
  }

  const { data, error } = await supabase
    .from("counterfactuals")
    .update(update)
    .eq("user_id", user.id)
    .eq("id", id)
    .select("id, decision_id, alternative_choice, body, credibility, user_note, verdict, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ counterfactual: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("counterfactuals")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
