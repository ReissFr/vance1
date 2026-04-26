// PATCH/DELETE /api/imagined-futures/[id] — resolve, pin, archive, or delete an imagined future (§171).
//
// PATCH body: one of
//   { mode: 'pursue', status_note: REQUIRED, pursue_intention_id? } — convert this imagined future into a present step
//   { mode: 'release', status_note: REQUIRED }                      — let it go, name what releases you from it
//   { mode: 'sitting_with', status_note?: optional }                — not yet — keep it as a live possibility without forcing a decision
//   { mode: 'grieve', status_note: REQUIRED }                       — mourn the future that's no longer available
//   { mode: 'dismiss', status_note?: optional }                     — false alarm / mis-extraction
//   { mode: 'unresolve' }                                           — back to active
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'edit', act_text?, future_state?, pull_kind?, weight? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "pursue", "release", "sitting_with", "grieve", "dismiss", "unresolve",
  "pin", "unpin", "archive", "restore", "edit",
]);
const VALID_PULL_KINDS = new Set(["seeking", "escaping", "grieving", "entertaining"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: {
    mode?: unknown;
    status_note?: unknown;
    pursue_intention_id?: unknown;
    act_text?: unknown;
    future_state?: unknown;
    pull_kind?: unknown;
    weight?: unknown;
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

  if (mode === "pursue") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (the first concrete step you're taking — what makes this future real now) is required when mode='pursue'" }, { status: 400 });
    }
    patch.status = "pursuing";
    patch.status_note = note;
    patch.resolved_at = nowIso;
    if (typeof body.pursue_intention_id === "string" && body.pursue_intention_id.length > 0) {
      patch.pursue_intention_id = body.pursue_intention_id;
    }
  } else if (mode === "release") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what releases you from this — what makes letting go right) is required when mode='release'" }, { status: 400 });
    }
    patch.status = "released";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "sitting_with") {
    patch.status = "sitting_with";
    patch.status_note = note || null;
    patch.resolved_at = nowIso;
  } else if (mode === "grieve") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what you're mourning — the version of you that won't get to live this) is required when mode='grieve'" }, { status: 400 });
    }
    patch.status = "grieved";
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
    patch.pursue_intention_id = null;
  } else if (mode === "pin") {
    patch.pinned = true;
  } else if (mode === "unpin") {
    patch.pinned = false;
  } else if (mode === "archive") {
    patch.archived_at = nowIso;
  } else if (mode === "restore") {
    patch.archived_at = null;
  } else if (mode === "edit") {
    if (typeof body.act_text === "string") {
      const v = body.act_text.trim();
      if (v.length < 4) return NextResponse.json({ error: "act_text too short" }, { status: 400 });
      patch.act_text = v.slice(0, 220);
    }
    if (typeof body.future_state === "string") {
      const v = body.future_state.trim();
      if (v.length < 4) return NextResponse.json({ error: "future_state too short" }, { status: 400 });
      patch.future_state = v.slice(0, 360);
    }
    if (typeof body.pull_kind === "string") {
      if (!VALID_PULL_KINDS.has(body.pull_kind)) return NextResponse.json({ error: "invalid pull_kind" }, { status: 400 });
      patch.pull_kind = body.pull_kind;
    }
    if (typeof body.weight === "number") {
      patch.weight = Math.max(1, Math.min(5, Math.round(body.weight)));
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "edit mode requires at least one field" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("imagined_futures")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, act_text, future_state, pull_kind, domain, weight, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, pursue_intention_id, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, imagined_future: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("imagined_futures")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
