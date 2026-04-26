// GET /api/past-self/[id] — fetch dialogue with all messages.
// PATCH /api/past-self/[id] — { pin } | { archive: true } | { restore: true } | { title }
// DELETE /api/past-self/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: dialogue, error: dErr } = await supabase
    .from("past_self_dialogues")
    .select("id, anchor_date, horizon_label, persona_snapshot, title, pinned, archived_at, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (dErr || !dialogue) return NextResponse.json({ error: "dialogue not found" }, { status: 404 });

  const { data: messages, error: mErr } = await supabase
    .from("past_self_messages")
    .select("id, role, content, created_at")
    .eq("dialogue_id", id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  return NextResponse.json({ dialogue, messages: messages ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { pin?: boolean; archive?: boolean; restore?: boolean; title?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pin === "boolean") update.pinned = body.pin;
  if (body.archive === true) update.archived_at = new Date().toISOString();
  if (body.restore === true) update.archived_at = null;
  if (typeof body.title === "string") update.title = body.title.slice(0, 200) || null;

  const { data, error } = await supabase
    .from("past_self_dialogues")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, anchor_date, horizon_label, title, pinned, archived_at, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ dialogue: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("past_self_dialogues")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
