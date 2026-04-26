// PATCH /api/question-graveyard/:id — respond to or annotate a buried question.
//   Bodies (mutually exclusive groups):
//     { status: "acknowledged" | "answered" | "contested" | "dismissed", status_note?: string }
//     { status_note: string }     — annotate without resolving
//     { pin: boolean }
//     { archive: true } / { restore: true }
//
//   When status='answered', status_note SHOULD be set to the user's actual answer.
//   This also stamps resolved_at and (if not already) sets answered=true with
//   answer_text=status_note + answer_date=today, so the answer is locked in.
//
// DELETE /api/question-graveyard/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["acknowledged", "answered", "contested", "dismissed"]);

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let body: {
    status?: string;
    status_note?: string;
    pin?: boolean;
    archive?: boolean;
    restore?: boolean;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  let answeringNow = false;
  if (body.status != null) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status must be acknowledged | answered | contested | dismissed" }, { status: 400 });
    }
    update.status = body.status;
    update.resolved_at = new Date().toISOString();
    if (body.status === "answered") answeringNow = true;
  }
  if (body.status_note != null) {
    if (typeof body.status_note !== "string") return NextResponse.json({ error: "status_note must be string" }, { status: 400 });
    update.status_note = body.status_note.trim().slice(0, 2000);
  }
  if (body.pin != null) {
    if (typeof body.pin !== "boolean") return NextResponse.json({ error: "pin must be boolean" }, { status: 400 });
    update.pinned = body.pin;
  }
  if (body.archive === true) update.archived_at = new Date().toISOString();
  if (body.restore === true) update.archived_at = null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no recognised fields" }, { status: 400 });
  }

  if (answeringNow) {
    update.answered = true;
    const note = typeof update.status_note === "string" ? (update.status_note as string) : "";
    if (note) {
      update.answer_text = note.slice(0, 2000);
    }
    update.answer_date = dateOnly(new Date().toISOString());
  }

  const { data: updated, error } = await supabase
    .from("question_graveyard")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, question_text, question_kind, needs_answer, domain, asked_date, asked_message_id, asked_conversation_id, topic_aliases, days_since_asked, asked_again_count, asked_again_days, answered, answer_text, answer_date, answer_message_id, days_to_answer, proposed_answer_excerpts, neglect_score, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ question: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("question_graveyard")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
