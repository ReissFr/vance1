// POST /api/ventures/[id]/pause — temporarily halt this venture's heartbeat.
//
// Sets ventures.paused_at without mutating ventures.status, so a 'launched'
// venture can be paused for a holiday and resume later in the same status.
// Distinct from status='paused' which is a deliberate pipeline state.

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
    .update({ paused_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("id", ventureId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, paused_at: new Date().toISOString() });
}
