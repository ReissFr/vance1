// PATCH /api/pre-write/:id — record what the user did with a draft.
//   Body shape (one of):
//     { status: "accepted", accepted_id?: string, user_score?: 1-5, user_note?: string }
//     { status: "edited",   accepted_id?: string, user_score?: 1-5, user_note?: string }
//     { status: "rejected", user_score?: 1-5, user_note?: string }
//   In all cases sets resolved_at = now().
//
// DELETE /api/pre-write/:id — remove a draft entirely.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RESOLVE_STATUSES = new Set(["accepted", "edited", "rejected"]);

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let body: {
    status?: string;
    accepted_id?: string | null;
    user_score?: number;
    user_note?: string;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (typeof body.status !== "string" || !RESOLVE_STATUSES.has(body.status)) {
    return NextResponse.json({ error: "status required: accepted | edited | rejected" }, { status: 400 });
  }

  const { data: existing, error: exErr } = await supabase
    .from("pre_writes")
    .select("id, user_id, status")
    .eq("id", id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ((existing as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update: Record<string, unknown> = {
    status: body.status,
    resolved_at: new Date().toISOString(),
  };

  if ((body.status === "accepted" || body.status === "edited") && body.accepted_id != null) {
    if (typeof body.accepted_id !== "string" || !isUuid(body.accepted_id)) {
      return NextResponse.json({ error: "accepted_id must be a uuid" }, { status: 400 });
    }
    update.accepted_id = body.accepted_id;
  }

  if (body.user_score != null) {
    const n = Math.round(Number(body.user_score));
    if (Number.isNaN(n) || n < 1 || n > 5) {
      return NextResponse.json({ error: "user_score must be 1-5" }, { status: 400 });
    }
    update.user_score = n;
  }

  if (body.user_note != null) {
    if (typeof body.user_note !== "string") {
      return NextResponse.json({ error: "user_note must be string" }, { status: 400 });
    }
    update.user_note = body.user_note.trim().slice(0, 500);
  }

  const { data: updated, error: upErr } = await supabase
    .from("pre_writes")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, kind, subkind, status, accepted_id, user_score, user_note, resolved_at")
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ pre_write: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("pre_writes")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
