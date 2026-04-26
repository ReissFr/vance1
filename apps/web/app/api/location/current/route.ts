// Returns the user's last known location + how stale it is. Consumed by the
// /places UI and anything that needs to render "current position".

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("profiles")
    .select("current_lat, current_lng, current_accuracy_m, current_location_at")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    location:
      data?.current_lat != null && data?.current_lng != null
        ? {
            lat: data.current_lat,
            lng: data.current_lng,
            accuracy_m: data.current_accuracy_m ?? null,
            at: data.current_location_at,
          }
        : null,
  });
}
