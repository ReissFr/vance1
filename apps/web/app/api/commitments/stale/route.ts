// Stale commitments — count + IDs of commitments where status='open' and the
// deadline is in the past. Used for NavRail badge + the Overdue filter view.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const nowIso = new Date().toISOString();

  const { data, count, error } = await supabase
    .from("commitments")
    .select("id, direction, deadline", { count: "exact" })
    .eq("status", "open")
    .lt("deadline", nowIso)
    .not("deadline", "is", null)
    .order("deadline", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let outbound = 0;
  let inbound = 0;
  for (const r of data ?? []) {
    if (r.direction === "outbound") outbound += 1;
    else if (r.direction === "inbound") inbound += 1;
  }

  return NextResponse.json({
    count: count ?? 0,
    outbound,
    inbound,
    ids: (data ?? []).map((r) => r.id),
  });
}
