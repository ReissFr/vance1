// PATCH /api/postmortems/[id]
//   Body shapes (mutually exclusive — pick one):
//     { actual_outcome, outcome_match (1-5), verdict, surprise_note?, lesson? }
//       Records the user's response. Sets responded_at = now().
//     { cancel: true }                Marks cancelled_at = now().
//     { restore: true }               Clears cancelled_at.
//     { snooze_days: N (1-365) }      Pushes due_at out by N days.
//     { mark_fired: true, fired_via }  Manually mark as fired (web/manual).
//
// DELETE /api/postmortems/[id] — hard delete.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PatchBody = {
  actual_outcome?: string;
  outcome_match?: number;
  verdict?: string;
  surprise_note?: string;
  lesson?: string;
  cancel?: boolean;
  restore?: boolean;
  snooze_days?: number;
  mark_fired?: boolean;
  fired_via?: string;
};

const VERDICTS = new Set(["right_call", "wrong_call", "mixed", "too_early", "unclear"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: PatchBody = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.cancel === true) {
    update.cancelled_at = new Date().toISOString();
  } else if (body.restore === true) {
    update.cancelled_at = null;
  } else if (typeof body.snooze_days === "number" && Number.isFinite(body.snooze_days)) {
    const days = Math.max(1, Math.min(365, Math.round(body.snooze_days)));
    const { data: existing, error: gErr } = await supabase
      .from("decision_postmortems")
      .select("due_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    const base = new Date((existing as { due_at: string }).due_at).getTime();
    update.due_at = new Date(base + days * 86400000).toISOString();
    update.fired_at = null;
  } else if (body.mark_fired === true) {
    update.fired_at = new Date().toISOString();
    if (typeof body.fired_via === "string" && ["whatsapp", "web", "manual"].includes(body.fired_via)) {
      update.fired_via = body.fired_via;
    } else {
      update.fired_via = "manual";
    }
  } else if (typeof body.actual_outcome === "string" || typeof body.outcome_match === "number" || typeof body.verdict === "string") {
    if (typeof body.actual_outcome !== "string" || body.actual_outcome.trim().length < 4) {
      return NextResponse.json({ error: "actual_outcome required (>=4 chars)" }, { status: 400 });
    }
    if (typeof body.outcome_match !== "number" || !Number.isFinite(body.outcome_match)) {
      return NextResponse.json({ error: "outcome_match required (1-5)" }, { status: 400 });
    }
    if (typeof body.verdict !== "string" || !VERDICTS.has(body.verdict)) {
      return NextResponse.json({ error: "verdict required (right_call|wrong_call|mixed|too_early|unclear)" }, { status: 400 });
    }
    update.actual_outcome = body.actual_outcome.trim().slice(0, 4000);
    update.outcome_match = Math.max(1, Math.min(5, Math.round(body.outcome_match)));
    update.verdict = body.verdict;
    update.responded_at = new Date().toISOString();
    if (typeof body.surprise_note === "string") update.surprise_note = body.surprise_note.trim().slice(0, 2000) || null;
    if (typeof body.lesson === "string") update.lesson = body.lesson.trim().slice(0, 2000) || null;
  } else {
    return NextResponse.json({ error: "no recognised patch fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("decision_postmortems")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, decision_id, due_at, scheduled_offset, fired_at, fired_via, responded_at, actual_outcome, outcome_match, surprise_note, lesson, verdict, cancelled_at, created_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (update.responded_at && data.decision_id) {
    const { data: dec } = await supabase
      .from("decisions")
      .select("reviewed_at")
      .eq("id", data.decision_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (dec && !(dec as { reviewed_at: string | null }).reviewed_at) {
      await supabase
        .from("decisions")
        .update({
          reviewed_at: update.responded_at as string,
          outcome_note: update.actual_outcome as string,
          outcome_label: update.verdict === "too_early" ? "unclear" : (update.verdict as string),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.decision_id)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({ postmortem: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("decision_postmortems")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
