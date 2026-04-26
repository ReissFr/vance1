// PATCH /api/soul-maps/[id] — update flags or user_note. Body shapes:
//   { pin: boolean }
//   { archive: true } | { restore: true }
//   { user_note: string }   ('' clears)
//
// DELETE /api/soul-maps/[id] — hard delete.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { pin?: boolean; archive?: boolean; restore?: boolean; user_note?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pin === "boolean") update.pinned = body.pin;
  if (body.archive === true) update.archived_at = new Date().toISOString();
  if (body.restore === true) update.archived_at = null;
  if (typeof body.user_note === "string") update.user_note = body.user_note.trim().slice(0, 2000) || null;

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "no recognised patch fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("soul_maps")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, nodes, edges, centroid_summary, drift_summary, source_counts, parent_id, pinned, archived_at, user_note, created_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ map: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("soul_maps").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
