// List the user's subscriptions. Default sort: active first, then by next
// renewal date ascending. Optional `?status=cancelled` / `?category=...`
// filters. The scan worker upserts rows, this endpoint is read-only.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");

  const admin = supabaseAdmin();
  let query = admin
    .from("subscriptions")
    .select(
      "id, service_name, amount, currency, cadence, status, next_renewal_date, last_charged_at, category, detection_source, confidence, user_confirmed, notes, first_seen_at, last_seen_at",
    )
    .eq("user_id", user.id);

  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);

  const { data, error } = await query.limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{
    id: string;
    status: string;
    next_renewal_date: string | null;
    cadence: string;
    amount: number | null;
  }>;
  rows.sort((a, b) => {
    const activeA = a.status === "active" || a.status === "trial" ? 0 : 1;
    const activeB = b.status === "active" || b.status === "trial" ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    const dA = a.next_renewal_date ?? "9999-12-31";
    const dB = b.next_renewal_date ?? "9999-12-31";
    return dA.localeCompare(dB);
  });

  return NextResponse.json({ subscriptions: rows });
}
