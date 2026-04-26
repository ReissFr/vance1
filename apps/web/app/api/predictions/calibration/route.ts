// GET /api/predictions/calibration — buckets all resolved predictions by
// confidence band (10pt buckets) and computes hit rate per bucket. Lets
// the page draw a calibration chart.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BANDS: Array<{ low: number; high: number; label: string }> = [
  { low: 1, high: 10, label: "1-10" },
  { low: 11, high: 20, label: "11-20" },
  { low: 21, high: 30, label: "21-30" },
  { low: 31, high: 40, label: "31-40" },
  { low: 41, high: 50, label: "41-50" },
  { low: 51, high: 60, label: "51-60" },
  { low: 61, high: 70, label: "61-70" },
  { low: 71, high: 80, label: "71-80" },
  { low: 81, high: 90, label: "81-90" },
  { low: 91, high: 99, label: "91-99" },
];

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("predictions")
    .select("confidence, status")
    .eq("user_id", user.id)
    .in("status", ["resolved_yes", "resolved_no"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{ confidence: number; status: string }>;
  const buckets = BANDS.map((b) => ({
    label: b.label,
    midpoint: (b.low + b.high) / 2,
    n: 0,
    yes: 0,
  }));

  for (const r of rows) {
    for (let i = 0; i < BANDS.length; i++) {
      const band = BANDS[i]!;
      const bucket = buckets[i]!;
      if (r.confidence >= band.low && r.confidence <= band.high) {
        bucket.n += 1;
        if (r.status === "resolved_yes") bucket.yes += 1;
        break;
      }
    }
  }

  const points = buckets.map((b) => ({
    label: b.label,
    midpoint: b.midpoint,
    n: b.n,
    hit_rate: b.n === 0 ? null : b.yes / b.n,
  }));

  const total = rows.length;
  const yesCount = rows.filter((r) => r.status === "resolved_yes").length;

  // Brier score: mean of (predicted - outcome)^2, where prediction is conf/100
  // and outcome is 1 for yes / 0 for no. Lower is better.
  let brierSum = 0;
  for (const r of rows) {
    const p = r.confidence / 100;
    const o = r.status === "resolved_yes" ? 1 : 0;
    brierSum += (p - o) ** 2;
  }
  const brier = total === 0 ? null : brierSum / total;

  return NextResponse.json({
    total,
    yes: yesCount,
    no: total - yesCount,
    brier,
    points,
  });
}
