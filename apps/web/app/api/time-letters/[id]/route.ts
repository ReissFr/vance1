// PATCH /api/time-letters/:id — pin / archive / restore / cancel /
//   reschedule / annotate. Bodies (mutually exclusive):
//     { pin: boolean }
//     { archive: true }   — sets archived_at = now()
//     { restore: true }   — clears archived_at
//     { cancel: true }    — sets cancelled_at = now() (forward only,
//                           prevents the cron from delivering)
//     { uncancel: true }  — clears cancelled_at
//     { target_date: "YYYY-MM-DD" } — reschedules a forward letter
//                           (must be in the future, must still be
//                           pending — not delivered, not cancelled)
//     { user_note: string } — the user's reaction after reading
//
// DELETE /api/time-letters/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isValidDateString(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let body: {
    pin?: boolean;
    archive?: boolean;
    restore?: boolean;
    cancel?: boolean;
    uncancel?: boolean;
    target_date?: string;
    user_note?: string;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.pin != null) {
    if (typeof body.pin !== "boolean") return NextResponse.json({ error: "pin must be boolean" }, { status: 400 });
    update.pinned = body.pin;
  }
  if (body.archive === true) update.archived_at = new Date().toISOString();
  if (body.restore === true) update.archived_at = null;
  if (body.cancel === true) update.cancelled_at = new Date().toISOString();
  if (body.uncancel === true) update.cancelled_at = null;
  if (body.target_date != null) {
    if (!isValidDateString(body.target_date)) return NextResponse.json({ error: "target_date YYYY-MM-DD required" }, { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    if (body.target_date <= today) return NextResponse.json({ error: "target_date must be in the future" }, { status: 400 });
    update.target_date = body.target_date;
  }
  if (body.user_note != null) {
    if (typeof body.user_note !== "string") return NextResponse.json({ error: "user_note must be string" }, { status: 400 });
    update.user_note = body.user_note.trim().slice(0, 800);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no recognised fields" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("time_letters")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, kind, title, body, written_at_date, target_date, delivered_at, delivered_via, source_summary, source_counts, latency_ms, model, user_note, pinned, archived_at, cancelled_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ letter: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("time_letters")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
