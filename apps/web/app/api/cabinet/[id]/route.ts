// PATCH /api/cabinet/:id — respond to a voice in the cabinet (§167).
//   Bodies (mutually exclusive groups):
//     { status: "acknowledged" | "integrating" | "retired" | "dismissed", status_note?: string }
//     { status_note: string }     — annotate without resolving
//     { pin: boolean }
//     { archive: true } / { restore: true }
//
//   When status='retired', status_note MUST name WHY you are taking authority back
//   from this voice ('this is my mum's standard, not mine; I do not give it ruling
//   weight any more').
//   When status='integrating', status_note MUST name WHAT WISDOM you are keeping
//   and what you are leaving behind ('I keep the values about presence; I leave the
//   guilt-as-pressure delivery').
//
// DELETE /api/cabinet/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["acknowledged", "integrating", "retired", "dismissed"]);

const SELECT_COLS = "id, scan_id, voice_name, voice_type, voice_relation, typical_phrases, typical_obligations, typical_kinds, typical_domains, airtime_score, influence_severity, charge_average, shoulds_attributed, used_to_linked, inheritance_mentions, first_detected_at, last_detected_at, detection_span_days, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at";

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
  let retiringNow = false;
  let integratingNow = false;
  if (body.status != null) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status must be acknowledged | integrating | retired | dismissed" }, { status: 400 });
    }
    update.status = body.status;
    update.resolved_at = new Date().toISOString();
    if (body.status === "retired") retiringNow = true;
    if (body.status === "integrating") integratingNow = true;
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

  if (retiringNow) {
    const note = typeof update.status_note === "string" ? (update.status_note as string) : "";
    if (!note) {
      return NextResponse.json({ error: "status_note (why you are taking authority back from this voice) is required when status='retired'" }, { status: 400 });
    }
  }
  if (integratingNow) {
    const note = typeof update.status_note === "string" ? (update.status_note as string) : "";
    if (!note) {
      return NextResponse.json({ error: "status_note (what wisdom you are keeping and what you are leaving behind) is required when status='integrating'" }, { status: 400 });
    }
  }

  update.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("voice_cabinet")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(SELECT_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ voice: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("voice_cabinet")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
