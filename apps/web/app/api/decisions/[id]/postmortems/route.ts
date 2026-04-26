// POST /api/decisions/[id]/postmortems — schedule one or more "did this play
// out?" check-ins for a decision. Body (all optional):
//   - offsets: array of "1w" | "2w" | "1mo" | "3mo" | "6mo" | "1y" | "2y"
//     (default: ["1w","1mo","3mo","6mo"])
//   - replace_pending: boolean — if true, cancels any existing un-fired
//     postmortems on this decision before inserting fresh ones.
//
// GET /api/decisions/[id]/postmortems — list all postmortems for one decision.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const OFFSET_MS: Record<string, number> = {
  "1w": 7 * 86400000,
  "2w": 14 * 86400000,
  "1mo": 30 * 86400000,
  "3mo": 90 * 86400000,
  "6mo": 180 * 86400000,
  "1y": 365 * 86400000,
  "2y": 2 * 365 * 86400000,
};

const DEFAULT_OFFSETS = ["1w", "1mo", "3mo", "6mo"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: decisionId } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { offsets?: unknown; replace_pending?: unknown } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const { data: decision, error: decErr } = await supabase
    .from("decisions")
    .select("id, title, created_at")
    .eq("user_id", user.id)
    .eq("id", decisionId)
    .maybeSingle();
  if (decErr) return NextResponse.json({ error: decErr.message }, { status: 500 });
  if (!decision) return NextResponse.json({ error: "decision not found" }, { status: 404 });

  const offsetsRaw = Array.isArray(body.offsets) && body.offsets.length > 0
    ? (body.offsets as unknown[])
    : (DEFAULT_OFFSETS as readonly string[]);
  const offsets: string[] = [];
  for (const o of offsetsRaw) {
    if (typeof o !== "string") continue;
    if (!OFFSET_MS[o]) continue;
    if (!offsets.includes(o)) offsets.push(o);
    if (offsets.length >= 8) break;
  }
  if (offsets.length === 0) return NextResponse.json({ error: "no valid offsets" }, { status: 400 });

  if (body.replace_pending === true) {
    const nowIso = new Date().toISOString();
    await supabase
      .from("decision_postmortems")
      .update({ cancelled_at: nowIso })
      .eq("user_id", user.id)
      .eq("decision_id", decisionId)
      .is("responded_at", null)
      .is("cancelled_at", null)
      .is("fired_at", null);
  }

  const baseDate = new Date(decision.created_at as string).getTime();
  const inserts = offsets.map((offset) => ({
    user_id: user.id,
    decision_id: decisionId,
    due_at: new Date(baseDate + (OFFSET_MS[offset] ?? 0)).toISOString(),
    scheduled_offset: offset,
  }));

  const { data, error } = await supabase
    .from("decision_postmortems")
    .insert(inserts)
    .select("id, decision_id, due_at, scheduled_offset, fired_at, responded_at, cancelled_at, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ scheduled: data ?? [], decision: { id: decision.id, title: decision.title } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: decisionId } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("decision_postmortems")
    .select("id, decision_id, due_at, scheduled_offset, fired_at, fired_via, responded_at, actual_outcome, outcome_match, surprise_note, lesson, verdict, cancelled_at, created_at")
    .eq("user_id", user.id)
    .eq("decision_id", decisionId)
    .order("due_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ postmortems: data ?? [] });
}
