// Kill switch. Flips autopilot_runs.status → 'cancelled'. The runner checks
// between rounds and aborts at the next boundary.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("autopilot_runs")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("user_id", user.id)
    .in("status", ["queued", "planning", "running"]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
