// PATCH/DELETE /api/fears/[id] — resolve, pin, archive, edit, or
// delete a row from the fear ledger (§180).
//
// PATCH body: one of
//   { mode: 'realised',           resolution_note: REQUIRED } — the feared event happened.
//   { mode: 'partially_realised', resolution_note: REQUIRED } — some of the feared event happened.
//   { mode: 'dissolved',          resolution_note: REQUIRED } — feared event did not happen and no longer feared.
//   { mode: 'displaced',          resolution_note: REQUIRED } — didn't happen but replaced by another fear.
//   { mode: 'unresolved',         resolution_note?: optional} — outcome still pending.
//   { mode: 'dismiss',            resolution_note?: optional} — false positive scan.
//   { mode: 'unresolve' }                                       — return to open.
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'edit', fear_text?, fear_kind?, feared_subject?, domain?, charge? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "realised", "partially_realised", "dissolved", "displaced",
  "unresolved", "dismiss",
  "unresolve", "pin", "unpin", "archive", "restore", "edit",
]);
const VALID_KIND = new Set([
  "catastrophising", "abandonment", "rejection", "failure",
  "loss", "shame", "inadequacy", "loss_of_control",
  "mortality", "future_uncertainty",
]);
const VALID_DOMAIN = new Set([
  "relationships", "work", "money", "health",
  "decision", "opportunity", "safety", "self", "unknown",
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
    fear_text?: unknown;
    fear_kind?: unknown;
    feared_subject?: unknown;
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
    .from("fears")
    .select("id, status, pinned, archived_at, resolved_at, fear_text, resolution_note")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (mode === "realised") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (what actually happened that the fear was right about) is required when mode='realised'" }, { status: 400 });
    }
    patch.status = "realised";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "partially_realised") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (what part of the fear actually happened, and what didn't) is required when mode='partially_realised'" }, { status: 400 });
    }
    patch.status = "partially_realised";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "dissolved") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (the fear didn't happen — what actually unfolded) is required when mode='dissolved'" }, { status: 400 });
    }
    patch.status = "dissolved";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "displaced") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (this fear didn't happen but a different one took its place — name the replacement) is required when mode='displaced'" }, { status: 400 });
    }
    patch.status = "displaced";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "unresolved") {
    patch.status = "unresolved";
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
  } else if (mode === "pin") {
    patch.pinned = true;
  } else if (mode === "unpin") {
    patch.pinned = false;
  } else if (mode === "archive") {
    patch.archived_at = nowIso;
  } else if (mode === "restore") {
    patch.archived_at = null;
  } else if (mode === "edit") {
    if (typeof body.fear_text === "string") {
      const v = body.fear_text.trim();
      if (v.length < 4) return NextResponse.json({ error: "fear_text too short" }, { status: 400 });
      patch.fear_text = v.slice(0, 280);
    }
    if (typeof body.fear_kind === "string") {
      if (!VALID_KIND.has(body.fear_kind)) return NextResponse.json({ error: "invalid fear_kind" }, { status: 400 });
      patch.fear_kind = body.fear_kind;
    }
    if (typeof body.feared_subject === "string") {
      const v = body.feared_subject.trim();
      patch.feared_subject = v.length === 0 ? null : v.slice(0, 160);
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
    .from("fears")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, fear_text, fear_kind, feared_subject, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, confidence, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, fear: data });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("fears").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
