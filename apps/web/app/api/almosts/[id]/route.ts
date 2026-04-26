// PATCH/DELETE /api/almosts/[id] — resolve, pin, archive, or delete a near-miss (§170).
//
// PATCH body: one of
//   { mode: 'honour', status_note: REQUIRED }                       — the brake was right, the line stands
//   { mode: 'mourn',  status_note: REQUIRED }                       — the brake was a self-betrayal, name what you'd want back
//   { mode: 'retry',  status_note: REQUIRED, retry_intention_id? }  — convert this past near-miss into a present commitment
//   { mode: 'dismiss', status_note?: optional }                     — false alarm / mis-extraction
//   { mode: 'unresolve' }                                           — back to active
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'edit', act_text?, pulled_back_by?, consequence_imagined?, kind?, regret_tilt?, weight? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "honour", "mourn", "retry", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit",
]);
const VALID_KINDS = new Set([
  "reaching_out", "saying_no", "leaving", "staying", "starting", "quitting",
  "spending", "refusing", "confronting", "asking", "confessing", "other",
]);
const VALID_TILTS = new Set(["relief", "regret", "mixed"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: {
    mode?: unknown;
    status_note?: unknown;
    retry_intention_id?: unknown;
    act_text?: unknown;
    pulled_back_by?: unknown;
    consequence_imagined?: unknown;
    kind?: unknown;
    regret_tilt?: unknown;
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

  if (mode === "honour") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what made the brake right — what wisdom stopped you) is required when mode='honour'" }, { status: 400 });
    }
    patch.status = "honoured";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "mourn") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what you'd want back — why the brake was a self-betrayal) is required when mode='mourn'" }, { status: 400 });
    }
    patch.status = "mourned";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "retry") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what you're committing to NOW — what action you're taking forward from this near-miss) is required when mode='retry'" }, { status: 400 });
    }
    patch.status = "retried";
    patch.status_note = note;
    patch.resolved_at = nowIso;
    if (typeof body.retry_intention_id === "string" && body.retry_intention_id.length > 0) {
      patch.retry_intention_id = body.retry_intention_id;
    }
  } else if (mode === "dismiss") {
    patch.status = "dismissed";
    patch.status_note = note || null;
    patch.resolved_at = nowIso;
  } else if (mode === "unresolve") {
    patch.status = "active";
    patch.status_note = null;
    patch.resolved_at = null;
    patch.retry_intention_id = null;
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
    if (typeof body.pulled_back_by === "string") {
      const v = body.pulled_back_by.trim();
      if (v.length < 4) return NextResponse.json({ error: "pulled_back_by too short" }, { status: 400 });
      patch.pulled_back_by = v.slice(0, 220);
    }
    if (typeof body.consequence_imagined === "string") {
      const v = body.consequence_imagined.trim();
      patch.consequence_imagined = v.length === 0 ? null : v.slice(0, 300);
    }
    if (typeof body.kind === "string") {
      if (!VALID_KINDS.has(body.kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });
      patch.kind = body.kind;
    }
    if (typeof body.regret_tilt === "string") {
      if (!VALID_TILTS.has(body.regret_tilt)) return NextResponse.json({ error: "invalid regret_tilt" }, { status: 400 });
      patch.regret_tilt = body.regret_tilt;
    }
    if (typeof body.weight === "number") {
      patch.weight = Math.max(1, Math.min(5, Math.round(body.weight)));
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "edit mode requires at least one field" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("almosts")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, act_text, pulled_back_by, consequence_imagined, kind, domain, weight, recency, regret_tilt, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, retry_intention_id, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, almost: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("almosts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
