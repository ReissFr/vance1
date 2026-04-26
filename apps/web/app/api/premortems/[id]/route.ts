// PATCH /api/premortems/[id] — update status with optional resolution note.
//   { status: 'watching'|'happened'|'avoided'|'dismissed', note?: string }
//   { likelihood: 1-5 }            — adjust likelihood manually
//   { mitigation: string }         — edit mitigation text
// DELETE /api/premortems/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUS = new Set(["watching", "happened", "avoided", "dismissed"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { status?: string; note?: string; likelihood?: number; mitigation?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) {
    if (!VALID_STATUS.has(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    update.status = body.status;
    update.resolved_at = body.status === "watching" ? null : new Date().toISOString();
    if (typeof body.note === "string") update.resolved_note = body.note.trim().slice(0, 500) || null;
  }
  if (typeof body.likelihood === "number") {
    update.likelihood = Math.max(1, Math.min(5, Math.round(body.likelihood)));
  }
  if (typeof body.mitigation === "string") {
    const m = body.mitigation.trim();
    update.mitigation = m.length > 0 ? m.slice(0, 400) : null;
  }

  const { data, error } = await supabase
    .from("decision_premortems")
    .update(update)
    .eq("user_id", user.id)
    .eq("id", id)
    .select("id, decision_id, failure_mode, likelihood, mitigation, status, resolved_at, resolved_note, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ premortem: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("decision_premortems")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
