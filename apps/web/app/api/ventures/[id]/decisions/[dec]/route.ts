// PATCH /api/ventures/[id]/decisions/[dec] — respond to a decision.
// DELETE — cancel a queued decision (hard-delete only if status='queued').
//
// Modes:
//   approve    — user approves a queued decision; sets status='approved'.
//   reject     — user rejects a queued decision; sets status='rejected'.
//   override   — user retroactively reverses an auto/notify decision.
//                Provide override_note explaining what should have happened
//                instead. The operator loop reads recent overrides into the
//                next heartbeat as feedback.
//   execute    — mark as executed (after approve OR external action).
//   fail       — mark as failed; optional outcome_note.
//   cancel     — cancel a queued decision (also DELETE-able).
//   outcome    — log outcome_note + outcome_postmortem_due_at without
//                changing status (used after the fact).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODES = new Set(["approve", "reject", "override", "execute", "fail", "cancel", "outcome"]);

type Params = { params: Promise<{ id: string; dec: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: ventureId, dec: decisionId } = await params;
  let body: {
    mode?: string;
    note?: string;
    override_note?: string;
    outcome_note?: string;
    outcome_postmortem_days?: number;
  } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const mode = String(body.mode ?? "");
  if (!MODES.has(mode)) return NextResponse.json({ error: "invalid mode" }, { status: 400 });

  const { data: dec, error: getErr } = await supabase
    .from("venture_decisions")
    .select("*")
    .eq("user_id", user.id)
    .eq("venture_id", ventureId)
    .eq("id", decisionId)
    .single();
  if (getErr || !dec) return NextResponse.json({ error: "decision not found" }, { status: 404 });

  const update: Record<string, unknown> = { user_responded_at: new Date().toISOString() };
  if (body.note) update.user_response_note = String(body.note).slice(0, 2000);

  if (mode === "approve") {
    if (dec.status !== "queued") return NextResponse.json({ error: "not in queued state" }, { status: 400 });
    update.status = "approved";
  } else if (mode === "reject") {
    if (dec.status !== "queued") return NextResponse.json({ error: "not in queued state" }, { status: 400 });
    update.status = "rejected";
  } else if (mode === "override") {
    const oNote = body.override_note ?? body.note;
    if (!oNote || oNote.length < 4) {
      return NextResponse.json({ error: "override_note (≥4 chars) is required" }, { status: 400 });
    }
    update.status = "overridden";
    update.user_response_note = String(oNote).slice(0, 2000);
  } else if (mode === "execute") {
    update.status = "executed";
    update.executed_at = new Date().toISOString();
    if (body.outcome_postmortem_days) {
      update.outcome_postmortem_due_at = new Date(
        Date.now() + Math.max(1, Math.round(body.outcome_postmortem_days)) * 86_400_000,
      ).toISOString();
    }
  } else if (mode === "fail") {
    update.status = "failed";
    if (body.outcome_note) update.outcome_note = String(body.outcome_note).slice(0, 2000);
  } else if (mode === "cancel") {
    update.status = "cancelled";
  } else if (mode === "outcome") {
    if (!body.outcome_note || body.outcome_note.length < 2) {
      return NextResponse.json({ error: "outcome_note required" }, { status: 400 });
    }
    update.outcome_note = String(body.outcome_note).slice(0, 2000);
  }

  const { data: updated, error: upErr } = await supabase
    .from("venture_decisions")
    .update(update)
    .eq("user_id", user.id)
    .eq("id", decisionId)
    .select("*")
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, decision: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: ventureId, dec: decisionId } = await params;
  const { error } = await supabase
    .from("venture_decisions")
    .delete()
    .eq("user_id", user.id)
    .eq("venture_id", ventureId)
    .eq("id", decisionId)
    .eq("status", "queued");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
