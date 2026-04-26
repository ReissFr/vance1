// PATCH /api/conversation-loops/:id — respond to or annotate a loop.
//   Bodies (mutually exclusive groups):
//     { status: "named" | "contested" | "dismissed", user_note?: string }
//     { status: "resolved", resolution_text: string (>=8 chars), user_note?: string }
//     { user_note: string }      — annotate without resolving
//     { pin: boolean }
//     { archive: true } / { restore: true }
//
// DELETE /api/conversation-loops/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["named", "resolved", "contested", "dismissed"]);

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
    user_note?: string;
    resolution_text?: string;
    pin?: boolean;
    archive?: boolean;
    restore?: boolean;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = {};

  if (body.status != null) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status must be named | resolved | contested | dismissed" }, { status: 400 });
    }
    update.user_status = body.status;
    update.resolved_at = new Date().toISOString();

    if (body.status === "resolved") {
      if (typeof body.resolution_text !== "string" || body.resolution_text.trim().length < 8) {
        return NextResponse.json({ error: "resolution_text required (min 8 chars) when status=resolved" }, { status: 400 });
      }
      update.resolution_text = body.resolution_text.trim().slice(0, 4000);
    }
  }

  if (body.user_note != null) {
    if (typeof body.user_note !== "string") return NextResponse.json({ error: "user_note must be string" }, { status: 400 });
    update.user_note = body.user_note.trim().slice(0, 800);
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
    .from("conversation_loops")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, loop_label, recurring_question, pattern_summary, domain, occurrence_count, span_days, first_seen_at, last_seen_at, sample_quotes, candidate_exit, strength, user_status, user_note, resolution_text, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ conversation_loop: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("conversation_loops")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
