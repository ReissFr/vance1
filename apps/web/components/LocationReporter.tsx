"use client";

// LocationReporter: watches the browser's geolocation and POSTs updates to
// /api/location/update. Mounted once at the app shell so JARVIS always has a
// recent fix to answer "where am I" / "from my current location" questions
// without asking the user. Silent — no UI unless there's an error.
//
// Permission prompt is the browser's native one. In the Tauri webview on
// macOS this triggers CoreLocation; in a browser it's the standard blue bar.
// First visit the user accepts once; thereafter it's remembered for the
// origin.

import { useEffect, useRef } from "react";

const MIN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const MIN_MOVEMENT_M = 50;

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function LocationReporter() {
  const lastSent = useRef<{ at: number; lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const now = Date.now();
        const last = lastSent.current;
        if (last) {
          const moved = distanceMeters(
            { lat: last.lat, lng: last.lng },
            { lat: latitude, lng: longitude },
          );
          if (now - last.at < MIN_UPDATE_INTERVAL_MS && moved < MIN_MOVEMENT_M) {
            return;
          }
        }
        lastSent.current = { at: now, lat: latitude, lng: longitude };
        void fetch("/api/location/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lat: latitude,
            lng: longitude,
            accuracy_m: accuracy,
          }),
        }).catch(() => {
          // swallow — next tick retries
        });
      },
      () => {
        // User denied or the device has no signal. Silent; the /places page
        // shows the real error with a reconnect CTA.
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 30_000,
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return null;
}
