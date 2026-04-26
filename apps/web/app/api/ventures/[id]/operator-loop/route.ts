// POST /api/ventures/[id]/operator-loop — fire one heartbeat for this venture.
//
// Thin wrapper around lib/venture-heartbeat.ts. The cron poller
// (/api/ventures/cron) calls the same shared function with the service-role
// client; this route uses the user-session client and works for the user
// pressing "fire heartbeat now" on the venture detail page.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { runVentureHeartbeat } from "@/lib/venture-heartbeat";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: ventureId } = await params;
  const result = await runVentureHeartbeat(supabase, user.id, ventureId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
