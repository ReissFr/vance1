// PATCH /api/self-erasures/:id — respond to or annotate a mined erasure.
//   Bodies (mutually exclusive groups):
//     { status: "restored" | "released" | "noted" | "dismissed", status_note?: string }
//     { status_note: string }     — annotate without resolving
//     { pin: boolean }
//     { archive: true } / { restore: true }
//
//   When status='restored', status_note MUST contain the restored thought —
//   what the user actually wanted to say before they cancelled it. The
//   restored text is stored in status_note.
//   When status='released', status_note (optional) holds the user's reason
//   for choosing to keep the erasure.
//
// DELETE /api/self-erasures/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["restored", "released", "noted", "dismissed"]);

const SELECT_COLS = "id, scan_id, erasure_text, erasure_kind, what_was_erased, what_was_erased_kind, censor_voice, domain, spoken_date, spoken_message_id, spoken_conversation_id, recurrence_count, recurrence_days, recurrence_with_target, recurrence_samples, pattern_severity, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at";

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
    status_note?: string;
    pin?: boolean;
    archive?: boolean;
    restore?: boolean;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  let restoringNow = false;
  if (body.status != null) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status must be restored | released | noted | dismissed" }, { status: 400 });
    }
    update.status = body.status;
    update.resolved_at = new Date().toISOString();
    if (body.status === "restored") restoringNow = true;
  }
  if (body.status_note != null) {
    if (typeof body.status_note !== "string") return NextResponse.json({ error: "status_note must be string" }, { status: 400 });
    update.status_note = body.status_note.trim().slice(0, 2000);
  }
  if (body.pin != null) {
    if (typeof body.pin !== "boolean") return NextResponse.json({ error: "pin must be boolean" }, { status: 400 });
    update.pinned = body.pin;
  }
  if (body.archive === true) update.archived_at = new Date().toISOString();
  if (body.restore === true) update.archived_at = null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no recognised fields" }, { status: 400 });
  }

  if (restoringNow) {
    const note = typeof update.status_note === "string" ? (update.status_note as string) : "";
    if (!note) {
      return NextResponse.json({ error: "status_note (the restored thought) is required when status='restored'" }, { status: 400 });
    }
  }

  const { data: updated, error } = await supabase
    .from("self_erasures")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(SELECT_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ erasure: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("self_erasures")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
