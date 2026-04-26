// Suggest a monthly budget for a category based on the last 90 days of
// receipts. Returns average monthly spend + a rounded recommendation with
// 10% headroom. Powers the "Suggest" button on /budgets.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category")?.trim().toLowerCase();
  const currency = (searchParams.get("currency") ?? "GBP").toUpperCase();
  if (!category) {
    return NextResponse.json({ error: "category required" }, { status: 400 });
  }

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("receipts")
    .select("amount, currency, purchased_at, created_at")
    .eq("category", category)
    .eq("currency", currency)
    .eq("archived", false)
    .gte("created_at", since)
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{
    amount: number | null;
    purchased_at: string | null;
    created_at: string;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({
      category,
      currency,
      samples: 0,
      avg_monthly: 0,
      suggested: 0,
      note: "no receipts in last 90 days",
    });
  }

  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const dates = rows.map((r) => new Date(r.purchased_at ?? r.created_at).getTime());
  const earliest = Math.min(...dates);
  const span = Math.max(1, (Date.now() - earliest) / (30 * 24 * 3600 * 1000));
  const avgMonthly = total / span;
  const suggested = Math.max(10, Math.ceil((avgMonthly * 1.1) / 10) * 10);

  return NextResponse.json({
    category,
    currency,
    samples: rows.length,
    avg_monthly: Math.round(avgMonthly * 100) / 100,
    suggested,
    note: `${rows.length} receipts over ${span.toFixed(1)} months`,
  });
}
