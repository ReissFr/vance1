// §174 — single-loop CRUD for the loops register.
// PATCH supports 11 modes mirroring the established pattern from §165–§172:
//   break / widen / settle  (require status_note ≥4 — these are the
//                            substantive resolutions; we want a sentence
//                            explaining HOW the loop ends, reframes, or
//                            settles, not just a status flip)
//   archive / dismiss / unresolve / restore
//   pin / unpin
//   edit (topic_text and/or status_note)
//
// Resolution semantics:
//   break    — committed to something that ENDS the loop
//   widen    — introduced new information; loop reframes (still alive but recast)
//   settle   — accepted the loop as part of who you are (some loops are care, not problems)
//   archive  — soft hide
//   dismiss  — false positive from the scan
//   unresolve — undo break/widen/settle/dismiss back to active
//   restore   — undo archive

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type Action =
  | "break" | "widen" | "settle" | "archive" | "dismiss"
  | "unresolve" | "restore" | "pin" | "unpin" | "edit";

const ACTION_NEEDS_NOTE = new Set<Action>(["break", "widen", "settle"]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  let body: { action?: string; status_note?: string; topic_text?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const action = (body.action || "") as Action;
  const note = typeof body.status_note === "string" ? body.status_note.trim() : "";
  const topicText = typeof body.topic_text === "string" ? body.topic_text.trim() : "";

  if (!action) return NextResponse.json({ error: "missing action" }, { status: 400 });

  if (ACTION_NEEDS_NOTE.has(action) && note.length < 4) {
    return NextResponse.json({ error: `${action} requires a status_note (≥4 chars) — write a sentence about how this loop ${action === "break" ? "ends" : action === "widen" ? "reframes" : "settles"}` }, { status: 400 });
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("loops")
    .select("id, status, status_note, pinned, archived_at, resolved_at")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (action === "break") {
    patch.status = "broken";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (action === "widen") {
    patch.status = "widened";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (action === "settle") {
    patch.status = "settled";
    patch.status_note = note;
    patch.resolved_at = nowIso;
  } else if (action === "dismiss") {
    patch.status = "dismissed";
    patch.resolved_at = nowIso;
    if (note) patch.status_note = note;
  } else if (action === "archive") {
    patch.archived_at = nowIso;
  } else if (action === "restore") {
    patch.archived_at = null;
  } else if (action === "unresolve") {
    patch.status = "active";
    patch.resolved_at = null;
    patch.status_note = null;
  } else if (action === "pin") {
    patch.pinned = true;
  } else if (action === "unpin") {
    patch.pinned = false;
  } else if (action === "edit") {
    if (topicText.length >= 4 && topicText.length <= 280) patch.topic_text = topicText;
    if (note) patch.status_note = note;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "edit requires topic_text (4-280 chars) or status_note" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  const { data: updated, error: updErr } = await supabase
    .from("loops")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, topic_text, loop_kind, domain, first_seen_date, last_seen_date, occurrence_count, distinct_chat_count, chronicity_days, amplitude, velocity, confidence, evidence_message_ids, status, status_note, resolved_at, pinned, archived_at, created_at, updated_at")
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, loop: updated, action });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("loops").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
