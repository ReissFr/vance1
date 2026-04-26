// PATCH/DELETE /api/thresholds/[id] — resolve, pin, archive, or delete a
// threshold crossing (§169).
//
// PATCH body: one of
//   { mode: 'integrate', status_note: REQUIRED } — own this crossing as identity evidence
//   { mode: 'dismiss',   status_note?: optional } — false alarm / mis-extraction
//   { mode: 'dispute',   status_note: REQUIRED } — push back on the framing
//   { mode: 'unresolve' }                          — back to active
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'edit', threshold_text?, before_state?, after_state?, charge?, magnitude? } — fix mis-extracted facts

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "integrate", "dismiss", "dispute", "unresolve", "pin", "unpin", "archive", "restore", "edit",
]);
const VALID_CHARGES = new Set(["growth", "drift", "mixed"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: {
    mode?: unknown;
    status_note?: unknown;
    threshold_text?: unknown;
    before_state?: unknown;
    after_state?: unknown;
    charge?: unknown;
    magnitude?: unknown;
  };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: `mode must be one of ${[...VALID_MODES].join("/")}` }, { status: 400 });
  }

  const note = typeof body.status_note === "string" ? body.status_note.trim().slice(0, 1500) : "";
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: nowIso };

  if (mode === "integrate") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what this crossing means to you as identity evidence) is required when mode='integrate'" }, { status: 400 });
    }
    patch.status = "integrated";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "dispute") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (how the framing is wrong — what was actually before vs after) is required when mode='dispute'" }, { status: 400 });
    }
    patch.status = "disputed";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "dismiss") {
    patch.status = "dismissed";
    patch.status_note = note || null;
    patch.resolved_at = nowIso;
  } else if (mode === "unresolve") {
    patch.status = "active";
    patch.status_note = null;
    patch.resolved_at = null;
  } else if (mode === "pin") {
    patch.pinned = true;
  } else if (mode === "unpin") {
    patch.pinned = false;
  } else if (mode === "archive") {
    patch.archived_at = nowIso;
  } else if (mode === "restore") {
    patch.archived_at = null;
  } else if (mode === "edit") {
    if (typeof body.threshold_text === "string") {
      const v = body.threshold_text.trim();
      if (v.length < 4) return NextResponse.json({ error: "threshold_text too short" }, { status: 400 });
      patch.threshold_text = v.slice(0, 220);
    }
    if (typeof body.before_state === "string") {
      const v = body.before_state.trim();
      if (v.length < 4) return NextResponse.json({ error: "before_state too short" }, { status: 400 });
      patch.before_state = v.slice(0, 240);
    }
    if (typeof body.after_state === "string") {
      const v = body.after_state.trim();
      if (v.length < 4) return NextResponse.json({ error: "after_state too short" }, { status: 400 });
      patch.after_state = v.slice(0, 240);
    }
    if (typeof body.charge === "string") {
      if (!VALID_CHARGES.has(body.charge)) return NextResponse.json({ error: "invalid charge" }, { status: 400 });
      patch.charge = body.charge;
    }
    if (typeof body.magnitude === "number") {
      patch.magnitude = Math.max(1, Math.min(5, Math.round(body.magnitude)));
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "edit mode requires at least one field" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("thresholds")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, threshold_text, before_state, after_state, pivot_kind, charge, magnitude, domain, crossed_recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, threshold: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("thresholds")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
