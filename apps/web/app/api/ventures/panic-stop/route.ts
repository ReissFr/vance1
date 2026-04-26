// POST /api/ventures/panic-stop — set the global ventures panic stop.
//
// Stops ALL venture autonomy for this user. The cron poller refuses to fire
// any heartbeat while this is set, and an in-flight heartbeat still classifies
// + queues but refuses to dispatch anything to start_errand.
//
// Body (optional): { reason?: string }
// Cleared via POST /api/ventures/panic-clear.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { reason?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const reason = (body.reason ?? "").toString().slice(0, 500) || null;

  const { error } = await supabase
    .from("profiles")
    .update({
      ventures_panic_stop_at: new Date().toISOString(),
      ventures_panic_stop_reason: reason,
    })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, panic_stop_at: new Date().toISOString(), reason });
}
