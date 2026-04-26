// PATCH/DELETE /api/gut-checks/[id] — resolve, pin, archive, edit, or
// delete a row from the gut-check ledger (§179).
//
// PATCH body: one of
//   { mode: 'verified_right',  resolution_note: REQUIRED }  — gut was right; followed it. Vindicated.
//   { mode: 'verified_wrong',  resolution_note: REQUIRED }  — gut was wrong; followed it. Costly.
//   { mode: 'ignored_regret',  resolution_note: REQUIRED }  — didn't follow; gut turned out right.
//   { mode: 'ignored_relief',  resolution_note: REQUIRED }  — didn't follow; gut was wrong. Glad you didn't.
//   { mode: 'unresolved',      resolution_note?: optional } — outcome still pending — flag, not close.
//   { mode: 'dismiss',         resolution_note?: optional } — false positive scan.
//   { mode: 'unresolve' }                                    — return to open.
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'edit', gut_text?, signal_kind?, subject_text?, domain?, charge? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "verified_right", "verified_wrong",
  "ignored_regret", "ignored_relief",
  "unresolved", "dismiss",
  "unresolve", "pin", "unpin", "archive", "restore", "edit",
]);
const VALID_SIGNAL = new Set([
  "warning", "pull", "suspicion", "trust",
  "unease", "certainty", "dread", "nudge", "hunch",
]);
const VALID_DOMAIN = new Set([
  "relationships", "work", "money", "health",
  "decision", "opportunity", "risk", "self", "unknown",
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
    gut_text?: unknown;
    signal_kind?: unknown;
    subject_text?: unknown;
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
    .from("gut_checks")
    .select("id, status, pinned, archived_at, resolved_at, gut_text, resolution_note")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (mode === "verified_right") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (what happened that proved your gut right) is required when mode='verified_right'" }, { status: 400 });
    }
    patch.status = "verified_right";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "verified_wrong") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (what happened that showed your gut was off — be honest, this is the calibration data) is required when mode='verified_wrong'" }, { status: 400 });
    }
    patch.status = "verified_wrong";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "ignored_regret") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (what happened that you wish you'd listened to your gut about) is required when mode='ignored_regret'" }, { status: 400 });
    }
    patch.status = "ignored_regret";
    patch.resolved_at = nowIso;
    patch.resolution_note = note;
  } else if (mode === "ignored_relief") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (why you're glad you didn't follow your gut on this one) is required when mode='ignored_relief'" }, { status: 400 });
    }
    patch.status = "ignored_relief";
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
    if (typeof body.gut_text === "string") {
      const v = body.gut_text.trim();
      if (v.length < 4) return NextResponse.json({ error: "gut_text too short" }, { status: 400 });
      patch.gut_text = v.slice(0, 280);
    }
    if (typeof body.signal_kind === "string") {
      if (!VALID_SIGNAL.has(body.signal_kind)) return NextResponse.json({ error: "invalid signal_kind" }, { status: 400 });
      patch.signal_kind = body.signal_kind;
    }
    if (typeof body.subject_text === "string") {
      const v = body.subject_text.trim();
      patch.subject_text = v.length === 0 ? null : v.slice(0, 160);
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
    .from("gut_checks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, gut_text, signal_kind, subject_text, domain, charge, recency, spoken_date, spoken_message_id, conversation_id, confidence, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, gut_check: data });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("gut_checks").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
