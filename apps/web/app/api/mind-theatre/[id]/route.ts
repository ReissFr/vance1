// PATCH/DELETE /api/mind-theatre/[id] — resolve or archive a Mind Theatre session (§168).
//
// PATCH body: { mode: 'went_with_voice'|'self_authored'|'silenced_voice'|'unresolved'|'archive', ... }
//
// Modes:
//   went_with_voice  — body { mode, chosen_voice_id, decision_note? } — voice gets airtime credit (denorm: bumps voice_cabinet.airtime_score by 1)
//   silenced_voice   — body { mode, silenced_voice_id, decision_note (REQUIRED) } — nudge voice toward retire (sets status='acknowledged' if active, sets status_note if empty)
//   self_authored    — body { mode, self_authored_answer (REQUIRED), decision_note? } — overrode all voices
//   unresolved       — body { mode } — back to unresolved (clears resolution fields)
//   archive          — body { mode } — soft archive

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "went_with_voice",
  "self_authored",
  "silenced_voice",
  "unresolved",
  "archive",
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: {
    mode?: unknown;
    chosen_voice_id?: unknown;
    silenced_voice_id?: unknown;
    self_authored_answer?: unknown;
    decision_note?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: `mode must be one of ${[...VALID_MODES].join("/")}` }, { status: 400 });
  }

  const decisionNote = typeof body.decision_note === "string" ? body.decision_note.trim().slice(0, 1500) : "";

  type SessionRow = { id: string; user_id: string; outcome: string; panel: unknown };
  const { data: existing, error: getErr } = await supabase
    .from("mind_theatre_sessions")
    .select("id, user_id, outcome, panel")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (getErr || !existing) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const session = existing as SessionRow;
  const panelArr = Array.isArray(session.panel) ? session.panel : [];
  const panelVoiceIds = new Set<string>();
  for (const p of panelArr) {
    if (p && typeof p === "object" && "voice_id" in p && typeof (p as { voice_id: unknown }).voice_id === "string") {
      panelVoiceIds.add((p as { voice_id: string }).voice_id);
    }
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (mode === "archive") {
    patch.archived_at = nowIso;
  } else if (mode === "unresolved") {
    patch.outcome = "unresolved";
    patch.chosen_voice_id = null;
    patch.silenced_voice_id = null;
    patch.self_authored_answer = null;
    patch.decision_note = null;
    patch.resolved_at = null;
  } else if (mode === "went_with_voice") {
    const chosenId = typeof body.chosen_voice_id === "string" ? body.chosen_voice_id : "";
    if (!chosenId || !panelVoiceIds.has(chosenId)) {
      return NextResponse.json({ error: "chosen_voice_id is required and must be a voice from this session's panel" }, { status: 400 });
    }
    patch.outcome = "went_with_voice";
    patch.chosen_voice_id = chosenId;
    patch.silenced_voice_id = null;
    patch.self_authored_answer = null;
    patch.decision_note = decisionNote || null;
    patch.resolved_at = nowIso;

    // bump airtime_score on the chosen voice (denorm)
    const { data: voiceRow } = await supabase
      .from("voice_cabinet")
      .select("id, airtime_score")
      .eq("id", chosenId)
      .eq("user_id", user.id)
      .single();
    if (voiceRow && typeof voiceRow === "object" && "airtime_score" in voiceRow) {
      const cur = typeof (voiceRow as { airtime_score?: unknown }).airtime_score === "number"
        ? (voiceRow as { airtime_score: number }).airtime_score
        : 0;
      await supabase
        .from("voice_cabinet")
        .update({ airtime_score: cur + 1, updated_at: nowIso })
        .eq("id", chosenId)
        .eq("user_id", user.id);
    }
  } else if (mode === "silenced_voice") {
    const silencedId = typeof body.silenced_voice_id === "string" ? body.silenced_voice_id : "";
    if (!silencedId || !panelVoiceIds.has(silencedId)) {
      return NextResponse.json({ error: "silenced_voice_id is required and must be a voice from this session's panel" }, { status: 400 });
    }
    if (decisionNote.length < 4) {
      return NextResponse.json({ error: "decision_note (why this voice does not get a vote on this question) is required when mode='silenced_voice'" }, { status: 400 });
    }
    patch.outcome = "silenced_voice";
    patch.silenced_voice_id = silencedId;
    patch.chosen_voice_id = null;
    patch.self_authored_answer = null;
    patch.decision_note = decisionNote;
    patch.resolved_at = nowIso;

    // nudge the silenced voice toward acknowledged (if currently 'active')
    const { data: voiceRow } = await supabase
      .from("voice_cabinet")
      .select("id, status, status_note")
      .eq("id", silencedId)
      .eq("user_id", user.id)
      .single();
    if (voiceRow && typeof voiceRow === "object") {
      const v = voiceRow as { status?: string; status_note?: string | null };
      const cabinetPatch: Record<string, unknown> = { updated_at: nowIso };
      if (v.status === "active") {
        cabinetPatch.status = "acknowledged";
        cabinetPatch.resolved_at = nowIso;
      }
      if (!v.status_note) {
        cabinetPatch.status_note = `silenced on a specific question · ${decisionNote.slice(0, 240)}`;
      }
      await supabase
        .from("voice_cabinet")
        .update(cabinetPatch)
        .eq("id", silencedId)
        .eq("user_id", user.id);
    }
  } else if (mode === "self_authored") {
    const answer = typeof body.self_authored_answer === "string" ? body.self_authored_answer.trim().slice(0, 2000) : "";
    if (answer.length < 4) {
      return NextResponse.json({ error: "self_authored_answer is required (4+ chars) — name what you are choosing yourself" }, { status: 400 });
    }
    patch.outcome = "self_authored";
    patch.self_authored_answer = answer;
    patch.chosen_voice_id = null;
    patch.silenced_voice_id = null;
    patch.decision_note = decisionNote || null;
    patch.resolved_at = nowIso;
  }

  const { data: updated, error: updErr } = await supabase
    .from("mind_theatre_sessions")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, question, context_note, panel, voices_consulted, dominant_stance, outcome, chosen_voice_id, silenced_voice_id, self_authored_answer, decision_note, latency_ms, model, created_at, resolved_at, archived_at")
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, session: updated });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("mind_theatre_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
