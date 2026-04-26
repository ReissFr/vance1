// GET /api/ventures/[id]/metrics  — list metrics for the venture (filterable by kind/range).
// POST /api/ventures/[id]/metrics — log a measurement.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_METRIC = new Set([
  "revenue_pence", "spend_pence", "mrr_pence", "arr_pence",
  "paying_customers", "free_users", "mau", "wau", "dau",
  "conversion_rate", "churn_rate", "nps",
  "page_views", "signups", "cac_pence", "ltv_pence",
  "support_tickets_open", "runway_days",
  "other",
]);

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const days = Math.max(1, Math.min(540, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
  const limit = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200));
  const sinceDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  let q = supabase
    .from("venture_metrics")
    .select("*")
    .eq("user_id", user.id)
    .eq("venture_id", id)
    .gte("captured_for_date", sinceDate)
    .order("captured_for_date", { ascending: false })
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (kind && kind !== "all" && VALID_METRIC.has(kind)) q = q.eq("metric_kind", kind);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const latestByKind: Record<string, { value: number; captured_for_date: string }> = {};
  for (const r of rows as { metric_kind: string; value: number; captured_for_date: string }[]) {
    if (!latestByKind[r.metric_kind]) {
      latestByKind[r.metric_kind] = { value: Number(r.value) || 0, captured_for_date: r.captured_for_date };
    }
  }

  return NextResponse.json({ metrics: rows, latest_by_kind: latestByKind });
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: {
    metric_kind?: string;
    value?: number;
    unit?: string;
    note?: string;
    captured_for_date?: string;
  } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const kind = String(body.metric_kind ?? "");
  if (!VALID_METRIC.has(kind)) return NextResponse.json({ error: "invalid metric_kind" }, { status: 400 });
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return NextResponse.json({ error: "value (number) is required" }, { status: 400 });
  }

  const insert: Record<string, unknown> = {
    user_id: user.id,
    venture_id: id,
    metric_kind: kind,
    value: body.value,
  };
  if (body.unit) insert.unit = String(body.unit).slice(0, 40);
  if (body.note) insert.note = String(body.note).slice(0, 1000);
  if (body.captured_for_date) insert.captured_for_date = body.captured_for_date;

  const { data, error } = await supabase
    .from("venture_metrics")
    .insert(insert)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, metric: data });
}
