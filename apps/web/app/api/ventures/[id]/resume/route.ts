// POST /api/ventures/[id]/resume — clear the paused_at flag and reschedule
// the next heartbeat for ~5 min from now so the operator picks up where it
// left off without a long delay.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: ventureId } = await params;

  const { error } = await supabase
    .from("ventures")
    .update({
      paused_at: null,
      next_heartbeat_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", ventureId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, resumed_at: new Date().toISOString() });
}
