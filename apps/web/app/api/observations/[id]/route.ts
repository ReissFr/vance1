// PATCH /api/observations/[id] — pin / dismiss / restore an observation.
//   { pin: true | false }
//   { dismiss: true } | { restore: true }
// DELETE /api/observations/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { pin?: boolean; dismiss?: boolean; restore?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pin === "boolean") update.pinned = body.pin;
  if (body.dismiss === true) update.dismissed_at = new Date().toISOString();
  if (body.restore === true) update.dismissed_at = null;

  const { data, error } = await supabase
    .from("observations")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, kind, body, confidence, source_refs, window_days, pinned, dismissed_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ observation: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("observations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
