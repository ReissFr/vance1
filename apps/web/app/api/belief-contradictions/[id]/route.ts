// PATCH /api/belief-contradictions/[id]
//   Body: { status: 'resolved_changed_mind' | 'resolved_still_true' |
//                  'resolved_one_off' | 'dismissed' | 'open',
//           note?: string }
// DELETE /api/belief-contradictions/[id]

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID = new Set([
  "open",
  "resolved_changed_mind",
  "resolved_still_true",
  "resolved_one_off",
  "dismissed",
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { status?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (!body.status || !VALID.has(body.status)) {
    return NextResponse.json({ error: "status must be one of open/resolved_changed_mind/resolved_still_true/resolved_one_off/dismissed" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status: body.status,
    updated_at: new Date().toISOString(),
  };
  if (body.status === "open") {
    update.resolved_at = null;
    update.resolved_note = null;
  } else {
    update.resolved_at = new Date().toISOString();
    if (typeof body.note === "string") update.resolved_note = body.note.slice(0, 600);
  }

  const { data, error } = await supabase
    .from("belief_contradictions")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(
      "id, claim_id, claim_kind, claim_text, evidence_kind, evidence_id, evidence_text, evidence_date, severity, note, status, resolved_at, resolved_note, scan_window_days, created_at, updated_at",
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contradiction: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("belief_contradictions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
