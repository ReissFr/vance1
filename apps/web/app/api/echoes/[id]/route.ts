// PATCH /api/echoes/[id] — { dismiss?: boolean, user_note?: string }
// DELETE /api/echoes/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { dismiss?: boolean; user_note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.dismiss === true) update.dismissed_at = new Date().toISOString();
  if (body.dismiss === false) update.dismissed_at = null;
  if (typeof body.user_note === "string") update.user_note = body.user_note.slice(0, 1000) || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("echoes")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(
      "id, source_kind, source_id, source_text_excerpt, source_date, match_kind, match_id, match_text_excerpt, match_date, similarity, similarity_note, user_note, dismissed_at, created_at",
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ echo: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("echoes")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
