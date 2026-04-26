// §175 — single-promise CRUD for the said-i-would ledger.
// PATCH actions:
//   kept       — the user did the thing. Optional resolution_note.
//   partial    — did some of it. Optional resolution_note.
//   broken     — explicitly chose NOT to. Optional resolution_note.
//   forgotten  — didn't remember until prompted. Optional resolution_note.
//   dismiss    — false positive from the scan.
//   unresolve  — return to pending (clears resolved_at and note).
//   pin / unpin — toggle pinned.
//   archive / restore — soft hide / un-hide.
//   reschedule — push target_date by N days. Body: {days: 1-365}.
//   edit       — fix promise_text or resolution_note.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type Action =
  | "kept" | "partial" | "broken" | "forgotten" | "dismiss"
  | "unresolve" | "pin" | "unpin" | "archive" | "restore"
  | "reschedule" | "edit";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  let body: { action?: string; resolution_note?: string; promise_text?: string; days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const action = (body.action || "") as Action;
  const note = typeof body.resolution_note === "string" ? body.resolution_note.trim() : "";
  const promiseText = typeof body.promise_text === "string" ? body.promise_text.trim() : "";

  if (!action) return NextResponse.json({ error: "missing action" }, { status: 400 });

  const { data: existing, error: fetchErr } = await supabase
    .from("said_i_woulds")
    .select("id, status, target_date, pinned, archived_at, resolved_at, promise_text, resolution_note")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (action === "kept" || action === "partial" || action === "broken" || action === "forgotten") {
    patch.status = action;
    patch.resolved_at = nowIso;
    if (note) patch.resolution_note = note;
  } else if (action === "dismiss") {
    patch.status = "dismissed";
    patch.resolved_at = nowIso;
    if (note) patch.resolution_note = note;
  } else if (action === "unresolve") {
    patch.status = "pending";
    patch.resolved_at = null;
    patch.resolution_note = null;
  } else if (action === "archive") {
    patch.archived_at = nowIso;
  } else if (action === "restore") {
    patch.archived_at = null;
  } else if (action === "pin") {
    patch.pinned = true;
  } else if (action === "unpin") {
    patch.pinned = false;
  } else if (action === "reschedule") {
    const days = typeof body.days === "number" ? Math.round(body.days) : NaN;
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: "reschedule requires days 1-365" }, { status: 400 });
    }
    const base = new Date(`${existing.target_date}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + days);
    patch.target_date = base.toISOString().slice(0, 10);
  } else if (action === "edit") {
    if (promiseText.length >= 4 && promiseText.length <= 280) patch.promise_text = promiseText;
    if (note) patch.resolution_note = note;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "edit requires promise_text (4-280 chars) or resolution_note" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  const { data: updated, error: updErr } = await supabase
    .from("said_i_woulds")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, promise_text, horizon_text, horizon_kind, domain, spoken_date, spoken_message_id, conversation_id, target_date, confidence, status, resolution_note, resolved_at, pinned, archived_at, created_at, updated_at")
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, promise: updated, action });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("said_i_woulds").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
