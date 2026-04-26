// GET /api/inner-council/[id] — fetch session with all voices.
// PATCH /api/inner-council/[id] — { pin } | { archive: true } | { restore: true } | { synthesis_note }
// DELETE /api/inner-council/[id] — cascade-deletes voices.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: session, error: sErr } = await supabase
    .from("inner_council_sessions")
    .select("id, question, synthesis_note, pinned, archived_at, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (sErr || !session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const { data: voices, error: vErr } = await supabase
    .from("inner_council_voices")
    .select("id, voice, content, confidence, starred, source_kinds, source_count, latency_ms, created_at")
    .eq("session_id", id)
    .eq("user_id", user.id)
    .order("voice", { ascending: true });
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  return NextResponse.json({ session, voices: voices ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { pin?: boolean; archive?: boolean; restore?: boolean; synthesis_note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pin === "boolean") update.pinned = body.pin;
  if (body.archive === true) update.archived_at = new Date().toISOString();
  if (body.restore === true) update.archived_at = null;
  if (typeof body.synthesis_note === "string") update.synthesis_note = body.synthesis_note.slice(0, 4000) || null;

  const { data, error } = await supabase
    .from("inner_council_sessions")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, question, synthesis_note, pinned, archived_at, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("inner_council_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
