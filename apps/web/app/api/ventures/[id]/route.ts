// GET /api/ventures/[id]      — full venture detail incl. queued decisions, recent metrics, recent signals.
// PATCH /api/ventures/[id]    — update name/thesis/status/budget/kill/matrix/memory/cadence.
// DELETE /api/ventures/[id]   — kill the venture (soft delete: status=killed; preserves audit trail).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set([
  "researching", "validated", "building", "launched", "scaling", "paused", "killed",
]);
const VALID_CADENCE = new Set(["daily", "twice_daily", "hourly", "weekly", "manual"]);
const VALID_AUTONOMY = new Set(["manual", "supervised", "autonomous", "full_autopilot"]);

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: venture, error } = await supabase
    .from("ventures")
    .select("*")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (error || !venture) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [decisions, signals, metrics] = await Promise.all([
    supabase
      .from("venture_decisions")
      .select("*")
      .eq("user_id", user.id)
      .eq("venture_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("venture_signals")
      .select("*")
      .eq("user_id", user.id)
      .eq("venture_id", id)
      .order("captured_at", { ascending: false })
      .limit(50),
    supabase
      .from("venture_metrics")
      .select("*")
      .eq("user_id", user.id)
      .eq("venture_id", id)
      .order("captured_for_date", { ascending: false })
      .limit(200),
  ]);

  return NextResponse.json({
    venture: {
      ...venture,
      runway_pence: Math.max(0, venture.budget_pence - venture.spent_pence),
    },
    decisions: decisions.data ?? [],
    signals: signals.data ?? [],
    metrics: metrics.data ?? [],
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const v = body.name.trim();
    if (v.length < 2 || v.length > 80) return NextResponse.json({ error: "name 2-80 chars" }, { status: 400 });
    update.name = v;
  }
  if (typeof body.thesis === "string") {
    const v = body.thesis.trim();
    if (v.length < 20 || v.length > 2000) return NextResponse.json({ error: "thesis 20-2000 chars" }, { status: 400 });
    update.thesis = v;
    update.thesis_revision = (typeof body.thesis_revision === "number" ? body.thesis_revision : 0) + 1;
  }
  if (typeof body.status === "string" && VALID_STATUS.has(body.status)) {
    update.status = body.status;
    if (body.status === "launched" && !body.launched_at) update.launched_at = new Date().toISOString();
  }
  if (typeof body.budget_pence === "number") update.budget_pence = Math.max(0, Math.round(body.budget_pence));
  if (typeof body.spent_pence === "number") update.spent_pence = Math.max(0, Math.round(body.spent_pence));
  if (typeof body.kill_criteria === "string") update.kill_criteria = body.kill_criteria.slice(0, 1000) || null;
  if (typeof body.operator_memory === "string") update.operator_memory = body.operator_memory.slice(0, 50_000);
  if (typeof body.cadence === "string" && VALID_CADENCE.has(body.cadence)) update.cadence = body.cadence;
  if (typeof body.autonomy === "string" && VALID_AUTONOMY.has(body.autonomy)) update.autonomy = body.autonomy;
  if (typeof body.paused_at === "string" || body.paused_at === null) update.paused_at = body.paused_at;
  if (body.decision_matrix && typeof body.decision_matrix === "object") update.decision_matrix = body.decision_matrix;
  if (typeof body.next_heartbeat_at === "string") update.next_heartbeat_at = body.next_heartbeat_at;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ventures")
    .update(update)
    .eq("user_id", user.id)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, venture: data });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: { reason?: string; hard?: boolean } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  if (body.hard) {
    const { error } = await supabase
      .from("ventures")
      .delete()
      .eq("user_id", user.id)
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, hard_deleted: true });
  }

  const { data, error } = await supabase
    .from("ventures")
    .update({
      status: "killed",
      killed_at: new Date().toISOString(),
      killed_reason: body.reason ? String(body.reason).slice(0, 500) : "killed by user",
      next_heartbeat_at: null,
    })
    .eq("user_id", user.id)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, venture: data });
}
