// PATCH /api/energy-forecasts/:id — record actuals + reactions.
//   Bodies (mutually exclusive shapes):
//     { actual_energy: 1-5, actual_mood: 1-5, actual_focus: 1-5 }
//        — stamps actual_*, scored_at, computes accuracy_score from
//          mean absolute error vs the prediction.
//     { user_note: string }
//     { pin: boolean }
//
// DELETE /api/energy-forecasts/:id — remove permanently.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function clamp1to5(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
}

// Mean absolute error → 1-5 accuracy score.
//   MAE 0    → 5 (every score on the dot)
//   MAE 0.5  → 4
//   MAE 1.0  → 4
//   MAE 1.5  → 3
//   MAE 2.0  → 2
//   MAE >=3  → 1
function maeToAccuracy(mae: number): number {
  if (mae < 0.34) return 5;
  if (mae < 1.01) return 4;
  if (mae < 1.67) return 3;
  if (mae < 2.34) return 2;
  return 1;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let body: {
    actual_energy?: number;
    actual_mood?: number;
    actual_focus?: number;
    user_note?: string;
    pin?: boolean;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const { data: existing, error: exErr } = await supabase
    .from("energy_forecasts")
    .select("id, user_id, energy_pred, mood_pred, focus_pred, scored_at")
    .eq("id", id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ex = existing as { user_id: string; energy_pred: number; mood_pred: number; focus_pred: number; scored_at: string | null };
  if (ex.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const update: Record<string, unknown> = {};

  // Score branch
  if (body.actual_energy != null || body.actual_mood != null || body.actual_focus != null) {
    const ae = clamp1to5(body.actual_energy);
    const am = clamp1to5(body.actual_mood);
    const af = clamp1to5(body.actual_focus);
    if (ae == null || am == null || af == null) {
      return NextResponse.json({ error: "actual_energy / actual_mood / actual_focus all required (1-5)" }, { status: 400 });
    }
    const mae = (Math.abs(ae - ex.energy_pred) + Math.abs(am - ex.mood_pred) + Math.abs(af - ex.focus_pred)) / 3;
    update.actual_energy = ae;
    update.actual_mood = am;
    update.actual_focus = af;
    update.accuracy_score = maeToAccuracy(mae);
    update.scored_at = new Date().toISOString();
  }

  if (body.user_note != null) {
    if (typeof body.user_note !== "string") return NextResponse.json({ error: "user_note must be string" }, { status: 400 });
    update.user_note = body.user_note.trim().slice(0, 500);
  }

  if (body.pin != null) {
    if (typeof body.pin !== "boolean") return NextResponse.json({ error: "pin must be boolean" }, { status: 400 });
    update.pinned = body.pin;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no recognised fields in body" }, { status: 400 });
  }

  const { data: updated, error: upErr } = await supabase
    .from("energy_forecasts")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, forecast_date, energy_pred, mood_pred, focus_pred, actual_energy, actual_mood, actual_focus, accuracy_score, scored_at, user_note, pinned")
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ forecast: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("energy_forecasts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
