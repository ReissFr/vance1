// POST /api/ventures/panic-clear — clear the global ventures panic stop.
//
// Resumes normal autonomy. Per-venture autonomy levels and pause states are
// untouched; this only flips the global kill switch back off.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("profiles")
    .update({
      ventures_panic_stop_at: null,
      ventures_panic_stop_reason: null,
    })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, cleared_at: new Date().toISOString() });
}
