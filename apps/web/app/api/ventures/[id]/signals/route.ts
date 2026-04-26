// GET /api/ventures/[id]/signals  — list signals for the venture (filterable).
// POST /api/ventures/[id]/signals — log a new signal (manual capture).
//
// Signals are anything the operator loop should weigh: customer emails,
// support tickets, churn events, competitor moves, metric anomalies.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_KIND = new Set([
  "customer_email", "support_ticket", "churn_event",
  "competitor_move", "metric_anomaly", "calendar_conflict",
  "review", "feature_request", "cancellation_reason",
  "press_mention", "social_mention", "other",
]);

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const includeProcessed = url.searchParams.get("include_processed") === "true";
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

  let q = supabase
    .from("venture_signals")
    .select("*")
    .eq("user_id", user.id)
    .eq("venture_id", id)
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (kind && kind !== "all" && VALID_KIND.has(kind)) q = q.eq("kind", kind);
  if (!includeProcessed) q = q.is("processed_at", null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ signals: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: { kind?: string; body?: string; source?: string; weight?: number; captured_at?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const kind = String(body.kind ?? "");
  if (!VALID_KIND.has(kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });

  const text = String(body.body ?? "").trim();
  if (text.length < 2 || text.length > 4000) {
    return NextResponse.json({ error: "body must be 2-4000 chars" }, { status: 400 });
  }
  const weight = Math.max(1, Math.min(5, Math.round(body.weight ?? 3)));

  const insert: Record<string, unknown> = {
    user_id: user.id,
    venture_id: id,
    kind,
    body: text,
    weight,
  };
  if (body.source) insert.source = String(body.source).slice(0, 500);
  if (body.captured_at) insert.captured_at = body.captured_at;

  const { data, error } = await supabase
    .from("venture_signals")
    .insert(insert)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, signal: data });
}
