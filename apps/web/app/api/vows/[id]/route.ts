// PATCH/DELETE /api/vows/[id] — resolve, pin, archive, or delete a vow (§172).
//
// PATCH body: one of
//   { mode: 'renew',   status_note: REQUIRED } — re-author the vow as still mine
//   { mode: 'revise',  status_note: REQUIRED, revised_to: REQUIRED } — supersede with new vow text
//   { mode: 'release', status_note: REQUIRED } — let it go, name what it protected
//   { mode: 'honour',  status_note: REQUIRED } — keep but acknowledge cost (the shadow)
//   { mode: 'dismiss', status_note?: optional } — false alarm / mis-extraction
//   { mode: 'unresolve' }
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'edit', vow_text?, shadow?, origin_event?, vow_age?, weight? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "renew", "revise", "release", "honour", "dismiss", "unresolve",
  "pin", "unpin", "archive", "restore", "edit",
]);
const VALID_VOW_AGES = new Set(["childhood", "adolescent", "early_adult", "adult", "recent", "unknown"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: {
    mode?: unknown;
    status_note?: unknown;
    revised_to?: unknown;
    vow_text?: unknown;
    shadow?: unknown;
    origin_event?: unknown;
    vow_age?: unknown;
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

  if (mode === "renew") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (re-author the vow as still mine — why it still holds) is required when mode='renew'" }, { status: 400 });
    }
    patch.status = "renewed";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "revise") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (why the spirit holds but the letter needs updating) is required when mode='revise'" }, { status: 400 });
    }
    const revisedTo = typeof body.revised_to === "string" ? body.revised_to.trim() : "";
    if (revisedTo.length < 4) {
      return NextResponse.json({ error: "revised_to (the new vow text replacing the old) is required when mode='revise'" }, { status: 400 });
    }
    patch.status = "revised";
    patch.status_note = note;
    patch.revised_to = revisedTo.slice(0, 240);
    patch.resolved_at = nowIso;
  } else if (mode === "release") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what this vow protected and why you no longer need it) is required when mode='release'" }, { status: 400 });
    }
    patch.status = "released";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "honour") {
    if (note.length < 4) {
      return NextResponse.json({ error: "status_note (what the cost is — what the shadow rules out — and why you keep it anyway) is required when mode='honour'" }, { status: 400 });
    }
    patch.status = "honoured";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "dismiss") {
    patch.status = "dismissed";
    patch.status_note = note || null;
    patch.resolved_at = nowIso;
  } else if (mode === "unresolve") {
    patch.status = "active";
    patch.status_note = null;
    patch.revised_to = null;
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
    if (typeof body.vow_text === "string") {
      const v = body.vow_text.trim();
      if (v.length < 4) return NextResponse.json({ error: "vow_text too short" }, { status: 400 });
      patch.vow_text = v.slice(0, 240);
    }
    if (typeof body.shadow === "string") {
      const v = body.shadow.trim();
      if (v.length < 4) return NextResponse.json({ error: "shadow too short" }, { status: 400 });
      patch.shadow = v.slice(0, 280);
    }
    if (typeof body.origin_event === "string") {
      const v = body.origin_event.trim();
      patch.origin_event = v.length === 0 ? null : v.slice(0, 240);
    }
    if (typeof body.vow_age === "string") {
      if (!VALID_VOW_AGES.has(body.vow_age)) return NextResponse.json({ error: "invalid vow_age" }, { status: 400 });
      patch.vow_age = body.vow_age;
    }
    if (typeof body.weight === "number") {
      patch.weight = Math.max(1, Math.min(5, Math.round(body.weight)));
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "edit mode requires at least one field" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("vows")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, vow_text, shadow, origin_event, vow_age, domain, weight, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, status_note, revised_to, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, vow: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("vows")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
