// PATCH/DELETE /api/owed-to-me/[id] — resolve, pin, archive, edit, or
// delete a row from the owed-to-me ledger (§178).
//
// PATCH body: one of
//   { mode: 'kept',       resolution_note?: optional }      — they did the thing
//   { mode: 'broken',     resolution_note: REQUIRED }       — they explicitly didn't
//   { mode: 'forgotten',  resolution_note: REQUIRED }       — they probably forgot; user let it go
//   { mode: 'raised',     resolution_note: REQUIRED, raised_outcome?: optional }
//                                                            — THE NOVEL RESOLUTION. User brought it up.
//   { mode: 'released',   resolution_note?: optional }      — user has let it go without expecting it
//   { mode: 'dismiss',    resolution_note?: optional }      — false positive
//   { mode: 'unresolve' }
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'reschedule', days: 1-365 }                     — push target_date by N days
//   { mode: 'edit',       promise_text?, relationship_with?, person_text?, domain?, charge? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "kept", "broken", "forgotten", "raised", "released", "dismiss",
  "unresolve", "pin", "unpin", "archive", "restore", "reschedule", "edit",
]);
const VALID_RELATIONSHIP = new Set([
  "partner", "parent", "sibling", "friend",
  "colleague", "boss", "client", "stranger", "unknown",
]);
const VALID_DOMAIN = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);
const VALID_RAISED_OUTCOME = new Set([
  "they_followed_through", "they_apologized", "they_explained",
  "they_dismissed_it", "no_response",
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: {
    mode?: unknown;
    resolution_note?: unknown;
    raised_outcome?: unknown;
    days?: unknown;
    promise_text?: unknown;
    relationship_with?: unknown;
    person_text?: unknown;
    domain?: unknown;
    charge?: unknown;
  };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: `mode must be one of ${[...VALID_MODES].join("/")}` }, { status: 400 });
  }

  const note = typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, 1500) : "";
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: nowIso };

  const { data: existing, error: fetchErr } = await supabase
    .from("owed_to_me")
    .select("id, status, target_date, pinned, archived_at, resolved_at, promise_text, resolution_note, raised_outcome")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (mode === "kept") {
    patch.status = "kept";
    patch.resolved_at = nowIso;
    if (note) patch.resolution_note = note;
  } else if (mode === "broken") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (what they said when they declined / what changed) is required when mode='broken'" }, { status: 400 });
    }
    patch.status = "broken";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "forgotten") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (your read on why this was forgotten and why you're letting it go) is required when mode='forgotten'" }, { status: 400 });
    }
    patch.status = "forgotten";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "raised") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (what you said when you brought it up) is required when mode='raised'" }, { status: 400 });
    }
    patch.status = "raised";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
    if (typeof body.raised_outcome === "string" && body.raised_outcome.length > 0) {
      if (!VALID_RAISED_OUTCOME.has(body.raised_outcome)) {
        return NextResponse.json({ error: `raised_outcome must be one of ${[...VALID_RAISED_OUTCOME].join("/")}` }, { status: 400 });
      }
      patch.raised_outcome = body.raised_outcome;
    }
  } else if (mode === "released") {
    patch.status = "released";
    patch.resolved_at = nowIso;
    if (note) patch.resolution_note = note;
  } else if (mode === "dismiss") {
    patch.status = "dismissed";
    patch.resolved_at = nowIso;
    if (note) patch.resolution_note = note;
  } else if (mode === "unresolve") {
    patch.status = "open";
    patch.resolution_note = null;
    patch.resolved_at = null;
    patch.raised_outcome = null;
  } else if (mode === "pin") {
    patch.pinned = true;
  } else if (mode === "unpin") {
    patch.pinned = false;
  } else if (mode === "archive") {
    patch.archived_at = nowIso;
  } else if (mode === "restore") {
    patch.archived_at = null;
  } else if (mode === "reschedule") {
    const days = typeof body.days === "number" ? Math.round(body.days) : NaN;
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: "reschedule requires days 1-365" }, { status: 400 });
    }
    const base = new Date(`${existing.target_date}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + days);
    patch.target_date = base.toISOString().slice(0, 10);
  } else if (mode === "edit") {
    if (typeof body.promise_text === "string") {
      const v = body.promise_text.trim();
      if (v.length < 4) return NextResponse.json({ error: "promise_text too short" }, { status: 400 });
      patch.promise_text = v.slice(0, 280);
    }
    if (typeof body.relationship_with === "string") {
      if (!VALID_RELATIONSHIP.has(body.relationship_with)) return NextResponse.json({ error: "invalid relationship_with" }, { status: 400 });
      patch.relationship_with = body.relationship_with;
    }
    if (typeof body.person_text === "string") {
      const v = body.person_text.trim();
      patch.person_text = v.length === 0 ? null : v.slice(0, 160);
    }
    if (typeof body.domain === "string") {
      if (!VALID_DOMAIN.has(body.domain)) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
      patch.domain = body.domain;
    }
    if (typeof body.charge === "number") {
      patch.charge = Math.max(1, Math.min(5, Math.round(body.charge)));
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "edit mode requires at least one field" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("owed_to_me")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, promise_text, horizon_text, horizon_kind, relationship_with, person_text, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, target_date, confidence, status, resolution_note, raised_outcome, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, owed: data });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("owed_to_me").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
