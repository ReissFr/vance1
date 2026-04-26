// GET /api/ventures/panic-status — current global panic stop state for the
// signed-in user. Used by VenturesBoard to render the red banner / toggle.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("profiles")
    .select("ventures_panic_stop_at, ventures_panic_stop_reason")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    panic_stop_at: data?.ventures_panic_stop_at ?? null,
    reason: data?.ventures_panic_stop_reason ?? null,
  });
}
