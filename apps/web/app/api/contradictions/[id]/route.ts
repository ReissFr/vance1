// §176 — single-contradiction CRUD for the contradictions ledger.
// PATCH actions:
//   evolved    — the LATER statement is now-true; the earlier was a past
//                self. resolution_note REQUIRED ≥4 (which is current,
//                what changed).
//   dual       — both statements hold in different contexts/moods/life-
//                phases. The novel resolution. resolution_note REQUIRED
//                ≥4 (in what contexts each holds).
//   confused   — the user genuinely doesn't know which holds. The
//                contradiction is alive and unreconciled. resolution_note
//                REQUIRED ≥4 (what makes this hard).
//   rejected   — neither statement is current; user has moved past both.
//                resolution_note REQUIRED ≥4 (the actual current stance).
//   dismiss    — false positive from the scan. Optional note.
//   unresolve  — return to open (clears resolved_at and note).
//   pin / unpin — toggle pinned.
//   archive / restore — soft hide / un-hide.
//   edit       — fix mis-extracted fields. ≥1 of statement_a /
//                statement_b / topic.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type Action =
  | "evolved" | "dual" | "confused" | "rejected"
  | "dismiss" | "unresolve" | "pin" | "unpin"
  | "archive" | "restore" | "edit";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  let body: { action?: string; resolution_note?: string; statement_a?: string; statement_b?: string; topic?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const action = (body.action || "") as Action;
  const note = typeof body.resolution_note === "string" ? body.resolution_note.trim() : "";

  if (!action) return NextResponse.json({ error: "missing action" }, { status: 400 });

  const { data: existing, error: fetchErr } = await supabase
    .from("contradictions")
    .select("id, status, statement_a, statement_b, topic, pinned, archived_at, resolved_at, resolution_note")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (action === "evolved") {
    if (note.length < 4) return NextResponse.json({ error: "evolved requires resolution_note (which is now current and what changed)" }, { status: 400 });
    patch.status = "evolved";
    patch.resolution_note = note;
    patch.resolved_at = nowIso;
  } else if (action === "dual") {
    if (note.length < 4) return NextResponse.json({ error: "dual requires resolution_note (in what contexts each statement holds)" }, { status: 400 });
    patch.status = "dual";
    patch.resolution_note = note;
    patch.resolved_at = nowIso;
  } else if (action === "confused") {
    if (note.length < 4) return NextResponse.json({ error: "confused requires resolution_note (what makes this hard to reconcile)" }, { status: 400 });
    patch.status = "confused";
    patch.resolution_note = note;
    patch.resolved_at = nowIso;
  } else if (action === "rejected") {
    if (note.length < 4) return NextResponse.json({ error: "rejected requires resolution_note (the actual current stance)" }, { status: 400 });
    patch.status = "rejected";
    patch.resolution_note = note;
    patch.resolved_at = nowIso;
  } else if (action === "dismiss") {
    patch.status = "dismissed";
    patch.resolved_at = nowIso;
    if (note) patch.resolution_note = note;
  } else if (action === "unresolve") {
    patch.status = "open";
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
  } else if (action === "edit") {
    const newA = typeof body.statement_a === "string" ? body.statement_a.trim() : "";
    const newB = typeof body.statement_b === "string" ? body.statement_b.trim() : "";
    const newTopic = typeof body.topic === "string" ? body.topic.trim() : "";
    if (newA.length >= 4 && newA.length <= 400) patch.statement_a = newA;
    if (newB.length >= 4 && newB.length <= 400) patch.statement_b = newB;
    if (newTopic.length >= 4 && newTopic.length <= 120) patch.topic = newTopic;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "edit requires at least one of statement_a / statement_b / topic with valid length" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  const { data: updated, error: updErr } = await supabase
    .from("contradictions")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, statement_a, statement_a_date, statement_a_msg_id, statement_b, statement_b_date, statement_b_msg_id, topic, contradiction_kind, domain, charge, confidence, days_apart, status, resolution_note, resolved_at, pinned, archived_at, created_at, updated_at")
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, contradiction: updated, action });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("contradictions").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
