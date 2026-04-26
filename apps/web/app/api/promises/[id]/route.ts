// PATCH /api/promises/:id — respond to or annotate a promise.
//   Bodies (mutually exclusive groups):
//     { status: "kept" | "broken" | "deferred" | "cancelled" | "unclear", status_note?: string }
//     { status_note: string }                — annotate without resolving
//     { deadline_date: "YYYY-MM-DD" | null } — adjust deadline (only when pending)
//     { pin: boolean }
//     { archive: true } / { restore: true }
//
// DELETE /api/promises/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["kept", "broken", "deferred", "cancelled", "unclear"]);

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
    deadline_date?: string | null;
    pin?: boolean;
    archive?: boolean;
    restore?: boolean;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.status != null) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status must be kept | broken | deferred | cancelled | unclear" }, { status: 400 });
    }
    update.status = body.status;
    update.resolved_at = new Date().toISOString();
  }
  if (body.status_note != null) {
    if (typeof body.status_note !== "string") return NextResponse.json({ error: "status_note must be string" }, { status: 400 });
    update.status_note = body.status_note.trim().slice(0, 800);
  }
  if (body.deadline_date !== undefined) {
    if (body.deadline_date === null) {
      update.deadline_date = null;
    } else if (typeof body.deadline_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.deadline_date)) {
      update.deadline_date = body.deadline_date;
    } else {
      return NextResponse.json({ error: "deadline_date must be YYYY-MM-DD or null" }, { status: 400 });
    }
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

  const { data: updated, error } = await supabase
    .from("promises")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, action_summary, original_quote, category, deadline_text, deadline_date, promised_at, source_conversation_id, source_message_id, strength, repeat_count, prior_promise_id, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ promise: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("promises")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
