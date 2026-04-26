// PATCH /api/identity/[id] — pin / retire / restore / mark contradicted / set note.
//   { pin: true | false }
//   { status: 'active' | 'dormant' | 'contradicted' | 'retired' }
//   { contradiction_note: string }
//   { user_note: string }
// DELETE /api/identity/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const STATUSES = ["active", "dormant", "contradicted", "retired"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { pin?: boolean; status?: string; contradiction_note?: string; user_note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pin === "boolean") update.pinned = body.pin;
  if (typeof body.status === "string" && STATUSES.includes(body.status)) update.status = body.status;
  if (typeof body.contradiction_note === "string") update.contradiction_note = body.contradiction_note.slice(0, 600) || null;
  if (typeof body.user_note === "string") update.user_note = body.user_note.slice(0, 600) || null;

  const { data, error } = await supabase
    .from("identity_claims")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, kind, statement, normalized_key, occurrences, first_seen_at, last_seen_at, source_refs, status, contradiction_note, user_note, pinned")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ claim: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("identity_claims")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
