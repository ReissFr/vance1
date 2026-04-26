// Daily spend heatmap — returns per-day receipt totals over the last N days,
// grouped by the user's dominant currency. Powers the /insights page heatmap.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Row = {
  amount: number | null;
  currency: string | null;
  purchased_at: string | null;
  created_at: string;
};

type DayCell = {
  date: string;
  total: number;
  count: number;
};

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(7, Math.min(Number(searchParams.get("days") ?? 84), 180));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("receipts")
    .select("amount, currency, purchased_at, created_at")
    .eq("user_id", user.id)
    .eq("archived", false)
    .gte("created_at", since)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];

  const currencyTotals: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency ?? "USD").toUpperCase();
    currencyTotals[cur] = (currencyTotals[cur] ?? 0) + Number(r.amount ?? 0);
  }
  const dominantCurrency =
    Object.entries(currencyTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  const cells: Record<string, DayCell> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const key = d.toISOString().slice(0, 10);
    cells[key] = { date: key, total: 0, count: 0 };
  }

  for (const r of rows) {
    const cur = (r.currency ?? "USD").toUpperCase();
    if (cur !== dominantCurrency) continue;
    const dateRaw = r.purchased_at ?? r.created_at;
    const key = dateRaw.slice(0, 10);
    const cell = cells[key];
    if (!cell) continue;
    cell.total += Number(r.amount ?? 0);
    cell.count += 1;
  }

  const series = Object.values(cells).sort((a, b) => a.date.localeCompare(b.date));
  const max = series.reduce((m, c) => Math.max(m, c.total), 0);
  const topDays = [...series]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const c of series) {
    const dow = new Date(c.date).getDay();
    weekdayTotals[dow] = (weekdayTotals[dow] ?? 0) + c.total;
    if (c.total > 0) weekdayCounts[dow] = (weekdayCounts[dow] ?? 0) + 1;
  }
  const weekdayAvg = weekdayTotals.map((t, i) =>
    (weekdayCounts[i] ?? 0) > 0 ? t / (weekdayCounts[i] ?? 1) : 0,
  );

  return NextResponse.json({
    days,
    currency: dominantCurrency,
    series,
    max: round2(max),
    total: round2(series.reduce((s, c) => s + c.total, 0)),
    top_days: topDays.map((c) => ({ ...c, total: round2(c.total) })),
    weekday_avg: weekdayAvg.map(round2),
    by_currency: Object.fromEntries(
      Object.entries(currencyTotals).map(([k, v]) => [k, round2(v)]),
    ),
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
