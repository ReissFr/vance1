// PATCH /api/latent-decisions/:id — respond to or annotate a candidate.
//   Bodies (mutually exclusive groups):
//     { status: "acknowledged" | "contested" | "dismissed", user_note?: string }
//     { user_note: string }      — just save a note without resolving
//     { pin: boolean }
//     { archive: true } / { restore: true }
//     { create_decision: true, decision_choice?: string, decision_tags?: string[] }
//        — materialise this latent decision into a real decisions row.
//          Auto-acknowledges. The new decisions row is linked back via
//          resulting_decision_id.
//
// DELETE /api/latent-decisions/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set(["acknowledged", "contested", "dismissed"]);

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let body: {
    status?: string;
    user_note?: string;
    pin?: boolean;
    archive?: boolean;
    restore?: boolean;
    create_decision?: boolean;
    decision_choice?: string;
    decision_tags?: string[];
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  // Branch 1: materialise as decision
  if (body.create_decision === true) {
    const { data: row } = await supabase
      .from("latent_decisions")
      .select("kind, label, candidate_decision")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const r = row as { kind: string; label: string; candidate_decision: string };

    const choice = (body.decision_choice ?? r.candidate_decision).trim().slice(0, 1000);
    const tags = Array.isArray(body.decision_tags) ? body.decision_tags.filter((t) => typeof t === "string").slice(0, 8) : ["latent"];

    const { data: newDec, error: decErr } = await supabase
      .from("decisions")
      .insert({
        user_id: user.id,
        title: r.label,
        choice,
        tags,
      })
      .select("id")
      .single();
    if (decErr || !newDec) return NextResponse.json({ error: decErr?.message ?? "decision insert failed" }, { status: 500 });
    const decId = (newDec as { id: string }).id;

    const { data: updated, error: updErr } = await supabase
      .from("latent_decisions")
      .update({
        user_status: "acknowledged",
        resulting_decision_id: decId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, scan_id, kind, label, candidate_decision, evidence_summary, evidence_old, evidence_new, strength, source_signal, user_status, user_note, resulting_decision_id, pinned, archived_at, resolved_at, latency_ms, model, created_at")
      .single();
    if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? "update failed" }, { status: 500 });

    return NextResponse.json({ latent_decision: updated, decision_id: decId });
  }

  const update: Record<string, unknown> = {};
  if (body.status != null) {
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status must be acknowledged | contested | dismissed" }, { status: 400 });
    }
    update.user_status = body.status;
    update.resolved_at = new Date().toISOString();
  }
  if (body.user_note != null) {
    if (typeof body.user_note !== "string") return NextResponse.json({ error: "user_note must be string" }, { status: 400 });
    update.user_note = body.user_note.trim().slice(0, 800);
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

  const { data: updated, error } = await supabase
    .from("latent_decisions")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, kind, label, candidate_decision, evidence_summary, evidence_old, evidence_new, strength, source_signal, user_status, user_note, resulting_decision_id, pinned, archived_at, resolved_at, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ latent_decision: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("latent_decisions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
