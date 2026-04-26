"use client";

// PlacesConsole: current location + saved places. Loads Leaflet from CDN so
// we don't add a heavy map dep. Each saved place becomes a marker; the live
// position is a pulsing dot. Clicking "pin this" on the current location
// opens the label modal and saves a new place at those coordinates.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { Card } from "@/components/jarvis/primitives";

type Place = {
  id: string;
  label: string;
  address: string | null;
  lat: number;
  lng: number;
  radius_m: number | null;
};

type Current = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  at: string;
} | null;

// Leaflet is loaded via CDN, not as an npm dep, so we describe the subset of
// the API we touch here rather than pulling in @types/leaflet.
type LatLng = [number, number];
type LeafletDivIconOptions = {
  className?: string;
  html?: string;
  iconSize?: [number, number];
  iconAnchor?: [number, number];
};
type LeafletTooltipOptions = {
  permanent?: boolean;
  direction?: string;
  offset?: [number, number];
  className?: string;
};
type LeafletIcon = unknown;
type LeafletMarker = {
  addTo(map: LeafletMap): LeafletMarker;
  bindTooltip(text: string, opts?: LeafletTooltipOptions): LeafletMarker;
  remove(): void;
};
type LeafletCircle = {
  addTo(map: LeafletMap): LeafletCircle;
  remove(): void;
};
type LeafletTileLayer = {
  addTo(map: LeafletMap): LeafletTileLayer;
};
type LeafletMap = {
  setView(center: LatLng, zoom: number): LeafletMap;
};
type Leaflet = {
  map(el: HTMLElement, opts?: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, opts?: Record<string, unknown>): LeafletTileLayer;
  marker(latlng: LatLng, opts?: { icon?: LeafletIcon }): LeafletMarker;
  circle(latlng: LatLng, opts?: Record<string, unknown>): LeafletCircle;
  divIcon(opts: LeafletDivIconOptions): LeafletIcon;
};

declare global {
  interface Window {
    L?: Leaflet;
  }
}

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

function formatAge(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const h = mins / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function PlacesConsole() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [current, setCurrent] = useState<Current>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LeafletMarker[]>([]);
  const currentMarkerRef = useRef<LeafletMarker | null>(null);
  const currentCircleRef = useRef<LeafletCircle | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [placesRes, currentRes] = await Promise.all([
        fetch("/api/places/list", { cache: "no-store" }),
        fetch("/api/location/current", { cache: "no-store" }),
      ]);
      const placesBody = (await placesRes.json()) as { ok: boolean; places: Place[] };
      const currentBody = (await currentRes.json()) as { ok: boolean; location: Current };
      setPlaces(placesBody.places);
      setCurrent(currentBody.location);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current || mapRef.current) return;
    const L = window.L;
    if (!L) return;
    const center = current
      ? ([current.lat, current.lng] as [number, number])
      : places && places[0]
      ? ([places[0].lat, places[0].lng] as [number, number])
      : ([51.5074, -0.1278] as [number, number]);
    const map = L.map(mapContainerRef.current, {
      center,
      zoom: 13,
      scrollWheelZoom: true,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
  }, [leafletReady, current, places]);

  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map || !places) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = places.map((p) => {
      const icon = L.divIcon({
        className: "jv-place-marker",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#6366f1;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.bindTooltip(p.label, { permanent: true, direction: "right", offset: [10, 0], className: "jv-place-tip" });
      return marker;
    });
  }, [places, leafletReady]);

  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;
    if (currentMarkerRef.current) currentMarkerRef.current.remove();
    if (currentCircleRef.current) currentCircleRef.current.remove();
    if (!current) return;
    const icon = L.divIcon({
      className: "jv-current-marker",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#ec4899;border:2px solid #fff;box-shadow:0 0 0 6px rgba(236,72,153,.18)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    currentMarkerRef.current = L.marker([current.lat, current.lng], { icon }).addTo(map);
    if (current.accuracy_m && current.accuracy_m > 20) {
      currentCircleRef.current = L.circle([current.lat, current.lng], {
        radius: current.accuracy_m,
        color: "#ec4899",
        weight: 1,
        opacity: 0.3,
        fillOpacity: 0.05,
      }).addTo(map);
    }
  }, [current]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Remove this place?")) return;
      try {
        const res = await fetch("/api/places/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error ?? "delete failed");
        await load();
      } catch (e) {
        setFlash(e instanceof Error ? e.message : String(e));
      }
    },
    [load],
  );

  const sorted = useMemo(() => places ?? [], [places]);

  const atPlace = useMemo(() => {
    if (!current || !places) return null;
    for (const p of places) {
      const d = haversineMeters(current.lat, current.lng, p.lat, p.lng);
      if (d <= (p.radius_m ?? 150)) return p.label;
    }
    return null;
  }, [current, places]);

  return (
    <>
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        strategy="afterInteractive"
        onLoad={() => setLeafletReady(true)}
      />
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />
      <style>{`
        .jv-place-tip { background: rgba(15,15,20,0.85); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 2px 7px; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.8px; text-transform: uppercase; border-radius: 4px; box-shadow: none; }
        .jv-place-tip::before { display: none; }
      `}</style>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 340px",
          gridTemplateRows: isMobile ? "260px 1fr" : "1fr",
          gap: 0,
          height: isMobile ? "auto" : "calc(100vh - 180px)",
          minHeight: 500,
        }}
      >
        <div
          style={{
            position: "relative",
            borderRight: isMobile ? "none" : "1px solid var(--rule)",
            borderBottom: isMobile ? "1px solid var(--rule)" : "none",
          }}
        >
          <div
            ref={mapContainerRef}
            style={{
              width: "100%",
              height: "100%",
              background: "var(--surface)",
            }}
          />
        </div>

        <div
          style={{
            overflow: "auto",
            padding: "20px 20px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            Current location
          </div>

          {current ? (
            <Card padding="14px 16px">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#ec4899",
                    boxShadow: "0 0 0 4px rgba(236,72,153,.2)",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {atPlace && (
                    <div
                      style={{
                        fontFamily: "var(--sans)",
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: "var(--ink)",
                        marginBottom: 2,
                      }}
                    >
                      At {atPlace}
                    </div>
                  )}
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      color: "var(--ink-2)",
                      letterSpacing: "0.4px",
                    }}
                  >
                    {current.lat.toFixed(5)}, {current.lng.toFixed(5)}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    {formatAge(current.at)}
                    {current.accuracy_m
                      ? ` · ±${Math.round(current.accuracy_m)}m`
                      : ""}
                  </div>
                </div>
                <button
                  onClick={() => setModalOpen(true)}
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "var(--ink)",
                    color: "#000",
                    border: "1px solid var(--ink)",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Pin
                </button>
              </div>
            </Card>
          ) : (
            <Card padding="14px 16px" style={{ borderStyle: "dashed" }}>
              <div
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 13,
                  color: "var(--ink-3)",
                  lineHeight: 1.5,
                }}
              >
                Waiting for a location fix. If the browser didn't ask for
                permission, check the address bar lock icon and allow location
                for this site.
              </div>
            </Card>
          )}

          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginTop: 8,
            }}
          >
            Add a place
          </div>

          <AddPlaceForm onSaved={load} />

          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginTop: 8,
            }}
          >
            Saved places ({sorted.length})
          </div>

          {sorted.length === 0 && (
            <div
              style={{
                fontFamily: "var(--sans)",
                fontSize: 13,
                color: "var(--ink-3)",
                lineHeight: 1.5,
              }}
            >
              Nothing yet. Add one above, or say "this is home" to JARVIS
              once you're there.
            </div>
          )}

          {sorted.map((p) => (
            <Card key={p.id} padding="12px 14px">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--indigo)",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--sans)",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--ink)",
                    }}
                  >
                    {p.label}
                  </div>
                  {p.address && (
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "var(--ink-3)",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.address}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void handleDelete(p.id)}
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 11.5,
                    color: "var(--ink-4)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}

          {flash && (
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--magenta)",
              }}
            >
              {flash}
            </div>
          )}
        </div>
      </div>

      {modalOpen && current && (
        <PinModal
          current={current}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            setFlash("pinned");
            void load();
          }}
        />
      )}
    </>
  );
}

function AddPlaceForm({ onSaved }: { onSaved: () => void | Promise<void> }) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const l = label.trim();
    const a = address.trim();
    if (!l || !a) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/places/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: l, address: a }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      setLabel("");
      setAddress("");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    fontFamily: "var(--sans)",
    fontSize: 13,
    padding: "9px 11px",
    borderRadius: 8,
    border: "1px solid var(--rule)",
    background: "var(--surface-2)",
    color: "var(--ink)",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        placeholder="Label (home, studio, mum's)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
        style={inputStyle}
      />
      <input
        placeholder="Address or postcode"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
        style={inputStyle}
      />
      {err && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--magenta)",
          }}
        >
          {err}
        </div>
      )}
      <button
        onClick={() => void submit()}
        disabled={busy || !label.trim() || !address.trim()}
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "#000",
          background: "var(--ink)",
          padding: "9px 14px",
          borderRadius: 8,
          border: "1px solid var(--ink)",
          cursor: busy ? "default" : "pointer",
          fontWeight: 500,
          opacity: busy || !label.trim() || !address.trim() ? 0.5 : 1,
          alignSelf: "flex-start",
        }}
      >
        {busy ? "saving…" : "Save place"}
      </button>
    </div>
  );
}

function PinModal({
  current,
  onClose,
  onSaved,
}: {
  current: NonNullable<Current>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!label.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/places/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          lat: current.lat,
          lng: current.lng,
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "26px 28px",
          width: 420,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            color: "var(--ink)",
            letterSpacing: "-0.2px",
          }}
        >
          Pin this location
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          {current.lat.toFixed(5)}, {current.lng.toFixed(5)}
        </div>
        <input
          autoFocus
          placeholder="e.g. home, studio, mum's"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--rule)",
            background: "var(--surface-2)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        {err && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--magenta)",
            }}
          >
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-3)",
              background: "transparent",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--rule)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !label.trim()}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "#000",
              background: "var(--ink)",
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--ink)",
              cursor: busy ? "default" : "pointer",
              fontWeight: 500,
              opacity: busy || !label.trim() ? 0.5 : 1,
            }}
          >
            {busy ? "saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
