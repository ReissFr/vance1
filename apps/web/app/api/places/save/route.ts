// Saves a named place from the /places UI. Accepts either explicit lat/lng
// (from "pin current location") or a free-text address which we geocode via
// Nominatim before saving.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type NominatimHit = {
  lat: string;
  lon: string;
  display_name: string;
};

async function geocode(
  address: string,
): Promise<{ lat: number; lng: number; display: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "JARVIS-PA/1.0 (reissfrostmh@gmail.com)",
      "Accept-Language": "en-GB,en",
    },
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as NominatimHit[];
  const first = hits[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, display: first.display_name };
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { label?: string; address?: string; lat?: number; lng?: number; radius_m?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const label = body.label?.trim();
  if (!label) return NextResponse.json({ ok: false, error: "label required" }, { status: 400 });

  let lat = body.lat;
  let lng = body.lng;
  let address = body.address?.trim() || null;

  if (typeof lat !== "number" || typeof lng !== "number") {
    if (!address) {
      return NextResponse.json(
        { ok: false, error: "need either lat/lng or an address" },
        { status: 400 },
      );
    }
    const hit = await geocode(address);
    if (!hit) {
      return NextResponse.json(
        { ok: false, error: "couldn't find that address — try adding city/postcode" },
        { status: 422 },
      );
    }
    lat = hit.lat;
    lng = hit.lng;
    address = hit.display;
  }

  const { data, error } = await supabase
    .from("saved_places")
    .upsert(
      {
        user_id: user.id,
        label,
        address,
        lat,
        lng,
        radius_m: body.radius_m ?? 150,
      },
      { onConflict: "user_id,label" },
    )
    .select("id, label, lat, lng")
    .single();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, place: data });
}
