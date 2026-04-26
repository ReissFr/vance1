// Client-side LocationReporter POSTs here every few minutes with the latest
// GPS fix. We store the last known position on the profile; the brain reads it
// via the get_current_location tool when the user asks for something that
// needs a pickup point ("order me an Uber", "what's nearby").
//
// We also diff against saved_places to detect geofence crossings: if the user
// enters a saved place's radius, fire a `location_arrived` automation
// trigger; if they leave, fire `location_left`. The automation engine does
// the rate-limiting + dedup.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { dispatchTrigger } from "@/lib/automation-engine";

export const runtime = "nodejs";

const MAX_ACCURACY_M = 5000;

function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { lat?: number; lng?: number; accuracy_m?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const { lat, lng, accuracy_m } = body;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return NextResponse.json({ ok: false, error: "lat and lng required" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ ok: false, error: "lat/lng out of range" }, { status: 400 });
  }
  if (typeof accuracy_m === "number" && accuracy_m > MAX_ACCURACY_M) {
    return NextResponse.json({ ok: false, error: "accuracy too low" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: prior } = await admin
    .from("profiles")
    .select("current_lat, current_lng")
    .eq("id", user.id)
    .single();
  const priorLat = prior?.current_lat as number | null | undefined;
  const priorLng = prior?.current_lng as number | null | undefined;

  const { error } = await admin
    .from("profiles")
    .update({
      current_lat: lat,
      current_lng: lng,
      current_accuracy_m: typeof accuracy_m === "number" ? accuracy_m : null,
      current_location_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const transitions: { place_id: string; kind: "arrived" | "left" }[] = [];
  const { data: places } = await admin
    .from("saved_places")
    .select("id, lat, lng, radius_m")
    .eq("user_id", user.id);

  for (const p of (places ?? []) as Array<{
    id: string;
    lat: number | null;
    lng: number | null;
    radius_m: number | null;
  }>) {
    if (p.lat == null || p.lng == null) continue;
    const radius = p.radius_m ?? 150;
    const nowIn = haversineMeters(lat, lng, p.lat, p.lng) <= radius;
    const wasIn =
      priorLat != null && priorLng != null
        ? haversineMeters(priorLat, priorLng, p.lat, p.lng) <= radius
        : false;
    if (nowIn && !wasIn) {
      transitions.push({ place_id: p.id, kind: "arrived" });
    } else if (!nowIn && wasIn) {
      transitions.push({ place_id: p.id, kind: "left" });
    }
  }

  for (const t of transitions) {
    void dispatchTrigger(
      admin,
      t.kind === "arrived" ? "location_arrived" : "location_left",
      user.id,
      { place_id: t.place_id, lat, lng },
    ).catch((e) => {
      console.error(
        `[location/update] dispatch ${t.kind} for ${t.place_id} failed:`,
        e,
      );
    });
  }

  return NextResponse.json({ ok: true, transitions });
}
