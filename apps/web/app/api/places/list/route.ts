// Returns the user's saved places (home, studio, mum's etc.). Rendered by
// the /places UI and used as a reference when the user wants to edit one.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("saved_places")
    .select("id, label, address, lat, lng, radius_m, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, places: data ?? [] });
}
