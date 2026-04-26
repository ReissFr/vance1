"use client";

import { useCallback, useEffect, useState } from "react";

type PivotKind = "capability" | "belief" | "boundary" | "habit" | "identity" | "aesthetic" | "relational" | "material";
type Charge = "growth" | "drift" | "mixed";
type Status = "active" | "integrated" | "dismissed" | "disputed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterPivotKind = PivotKind | "all";
type FilterCharge = Charge | "all";

type Threshold = {
  id: string;
  scan_id: string;
  threshold_text: string;
  before_state: string;
  after_state: string;
  pivot_kind: PivotKind;
  charge: Charge;
  magnitude: number;
  domain: string;
  crossed_recency: "recent" | "older";
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: Status;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  active: number;
  integrated: number;
  dismissed: number;
  disputed: number;
  pinned: number;
  growth: number;
  drift: number;
  mixed: number;
  high_magnitude: number;
  drift_active: number;
  growth_integrated: number;
  pivot_kind_counts: Record<string, number>;
  charge_by_pivot: Record<string, { growth: number; drift: number; mixed: number }>;
  most_recent_drift: { id: string; spoken_date: string } | null;
  biggest_growth: { id: string; spoken_date: string; magnitude: number } | null;
};

const PIVOT_LABEL: Record<PivotKind, string> = {
  capability: "CAPABILITY",
  belief: "BELIEF",
  boundary: "BOUNDARY",
  habit: "HABIT",
  identity: "IDENTITY",
  aesthetic: "AESTHETIC",
  relational: "RELATIONAL",
  material: "MATERIAL",
};

const PIVOT_COLOR: Record<PivotKind, string> = {
  capability: "#7affcb",
  belief: "#bfd4ee",
  boundary: "#fbb86d",
  habit: "#ffd966",
  identity: "#c9b3f4",
  aesthetic: "#f4c9d8",
  relational: "#f4a8a8",
  material: "#b8c9b8",
};

const CHARGE_LABEL: Record<Charge, string> = {
  growth: "GROWTH",
  drift: "DRIFT",
  mixed: "MIXED",
};

const CHARGE_COLOR: Record<Charge, string> = {
  growth: "#7affcb",
  drift: "#f4577a",
  mixed: "#fbb86d",
};

const CHARGE_BLURB: Record<Charge, string> = {
  growth: "you crossed a line in the direction you wanted",
  drift: "you crossed a line you may not have signed off on",
  mixed: "this crossing has both flavours",
};

const STATUS_COLOR: Record<Status, string> = {
  active: "#bfb5a8",
  integrated: "#7affcb",
  dismissed: "#9aa28e",
  disputed: "#f4a8a8",
};

const MAG_LABEL: Record<number, string> = {
  1: "TINY",
  2: "SMALL",
  3: "MEANINGFUL",
  4: "SUBSTANTIAL",
  5: "FUNDAMENTAL",
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  if (day < 90) return `${Math.round(day / 7)}w ago`;
  return `${Math.round(day / 30)}mo ago`;
}

function dotMeter(score: number, color: string): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 6, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function ThresholdsConsole() {
  const [rows, setRows] = useState<Threshold[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [pivotFilter, setPivotFilter] = useState<FilterPivotKind>("all");
  const [chargeFilter, setChargeFilter] = useState<FilterCharge>("all");
  const [minMagnitude, setMinMagnitude] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [windowDays, setWindowDays] = useState<number>(180);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"integrate" | "dispute" | "dismiss">("integrate");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("pivot_kind", pivotFilter);
      params.set("charge", chargeFilter);
      params.set("min_magnitude", String(minMagnitude));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "150");
      const r = await fetch(`/api/thresholds?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { thresholds: Threshold[]; stats: Stats };
      setRows(j.thresholds);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, pivotFilter, chargeFilter, minMagnitude, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/thresholds/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; latency_ms?: number; signals?: Record<string, number> };
      setScanResult({ inserted: j.inserted, latency_ms: j.latency_ms, signals: j.signals });
      setStatusFilter("active");
      await load();
      setTimeout(() => setScanResult(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/thresholds/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.text();
        throw new Error(`HTTP ${r.status}: ${e.slice(0, 200)}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submitResolve = async (t: Threshold) => {
    setError(null);
    if ((resolveMode === "integrate" || resolveMode === "dispute") && resolveNote.trim().length < 4) {
      setError(resolveMode === "integrate"
        ? "write what this crossing means to you as identity evidence (4+ chars)"
        : "write how the framing is wrong (4+ chars)");
      return;
    }
    await patch(t.id, { mode: resolveMode, status_note: resolveNote.trim() || undefined });
    setResolveOpenId(null);
    setResolveNote("");
  };

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} crossings · ${stats.growth} growth · ${stats.drift} drift · ${stats.high_magnitude} substantial+` : ""}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
            style={{
              background: "#1a1612",
              border: "1px solid #2a2620",
              color: "#e8e0d2",
              padding: "6px 10px",
              fontSize: 11,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            <option value={60}>60d window</option>
            <option value={90}>90d window</option>
            <option value={180}>180d window</option>
            <option value={365}>1y window</option>
            <option value={730}>2y window</option>
          </select>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{
              background: scanning ? "#2a2620" : "#7affcb",
              color: scanning ? "#8a8378" : "#0f0d0a",
              border: "none",
              padding: "8px 18px",
              fontSize: 11,
              letterSpacing: 1.6,
              textTransform: "uppercase",
              fontWeight: 600,
              cursor: scanning ? "default" : "pointer",
            }}
          >
            {scanning ? "Scanning..." : "Scan for crossings"}
          </button>
        </div>
      </div>

      {/* Stats grid */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 18 }}>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #7affcb" }}>
            <div style={{ fontSize: 9, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase" }}>Growth crossings</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.growth}</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #f4577a" }}>
            <div style={{ fontSize: 9, color: "#f4577a", letterSpacing: 1.4, textTransform: "uppercase" }}>Drift crossings</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.drift}</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #fbb86d" }}>
            <div style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>Substantial+ (mag &ge; 4)</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.high_magnitude}</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #bfb5a8" }}>
            <div style={{ fontSize: 9, color: "#bfb5a8", letterSpacing: 1.4, textTransform: "uppercase" }}>Integrated</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.integrated}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Status:</span>
        {(["active", "integrated", "dismissed", "disputed", "pinned", "archived", "all"] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              background: statusFilter === s ? "#2a2620" : "transparent",
              border: `1px solid ${statusFilter === s ? "#5a5248" : "#2a2620"}`,
              color: statusFilter === s ? "#e8e0d2" : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Charge:</span>
        {(["all", "growth", "drift", "mixed"] as FilterCharge[]).map((c) => (
          <button
            key={c}
            onClick={() => setChargeFilter(c)}
            style={{
              background: chargeFilter === c ? "#2a2620" : "transparent",
              border: `1px solid ${chargeFilter === c ? (c === "all" ? "#5a5248" : CHARGE_COLOR[c as Charge]) : "#2a2620"}`,
              color: chargeFilter === c ? (c === "all" ? "#e8e0d2" : CHARGE_COLOR[c as Charge]) : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Pivot:</span>
        {(["all", "capability", "belief", "boundary", "habit", "identity", "aesthetic", "relational", "material"] as FilterPivotKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setPivotFilter(k)}
            style={{
              background: pivotFilter === k ? "#2a2620" : "transparent",
              border: `1px solid ${pivotFilter === k ? "#5a5248" : "#2a2620"}`,
              color: pivotFilter === k ? "#e8e0d2" : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {k}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Min mag:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setMinMagnitude(n)}
            style={{
              background: minMagnitude === n ? "#2a2620" : "transparent",
              border: `1px solid ${minMagnitude === n ? "#5a5248" : "#2a2620"}`,
              color: minMagnitude === n ? "#e8e0d2" : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {n}+
          </button>
        ))}
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginLeft: 12 }}>Min conf:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setMinConfidence(n)}
            style={{
              background: minConfidence === n ? "#2a2620" : "transparent",
              border: `1px solid ${minConfidence === n ? "#5a5248" : "#2a2620"}`,
              color: minConfidence === n ? "#e8e0d2" : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {n}+
          </button>
        ))}
      </div>

      {scanResult && (
        <div style={{ padding: "12px 14px", background: "#0f1a14", border: "1px solid #1f3a2c", borderLeft: "3px solid #7affcb", color: "#bfb5a8", fontSize: 12, marginBottom: 16 }}>
          {scanResult.inserted} new threshold{scanResult.inserted === 1 ? "" : "s"} surfaced
          {scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 14px", background: "#2a1a1a", border: "1px solid #5a3232", color: "#f4a8a8", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0" }}>Loading thresholds...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0", fontStyle: "italic" }}>
          No threshold crossings on file for these filters. Run a scan above to surface moments where past-self would not recognise present-self.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((t) => {
            const chargeColor = CHARGE_COLOR[t.charge];
            const pivotColor = PIVOT_COLOR[t.pivot_kind] ?? "#bfb5a8";
            const statusColor = STATUS_COLOR[t.status];
            const leftBorder = t.status === "active" ? chargeColor : statusColor;
            const isResolveOpen = resolveOpenId === t.id;

            return (
              <div key={t.id} style={{
                background: "#1a1612",
                border: "1px solid #2a2620",
                borderLeft: `3px solid ${leftBorder}`,
                padding: "16px 18px",
                opacity: t.status === "dismissed" ? 0.6 : 1,
              }}>
                {/* Threshold text + tags */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 22,
                      color: "#e8e0d2",
                      lineHeight: 1.3,
                      fontStyle: "italic",
                    }}>
                      &ldquo;{t.threshold_text}&rdquo;
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 9,
                        color: chargeColor,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        border: `1px solid ${chargeColor}`,
                        padding: "3px 8px",
                      }}>
                        {CHARGE_LABEL[t.charge]}
                      </span>
                      <span style={{
                        fontSize: 9,
                        color: pivotColor,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                      }}>
                        {PIVOT_LABEL[t.pivot_kind]}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.2 }}>{MAG_LABEL[t.magnitude]}</span>
                      {dotMeter(t.magnitude, chargeColor)}
                    </div>
                    <span style={{ fontSize: 10, color: "#5a5248" }}>
                      {t.spoken_date} · {t.crossed_recency}
                    </span>
                  </div>
                </div>

                {/* Before / After panel */}
                <div style={{
                  marginTop: 14,
                  background: "#0f0d0a",
                  border: "1px solid #2a2620",
                  padding: "14px 16px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}>
                  <div style={{ borderRight: "1px solid #2a2620", paddingRight: 16 }}>
                    <div style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>Before</div>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 15,
                      color: "#bfb5a8",
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}>
                      {t.before_state}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: chargeColor, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>After</div>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 15,
                      color: "#e8e0d2",
                      lineHeight: 1.5,
                    }}>
                      {t.after_state}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: "#8a8378", marginTop: 10, fontStyle: "italic" }}>
                  {CHARGE_BLURB[t.charge]} · domain · {t.domain}
                </div>

                {/* Status note */}
                {t.status !== "active" && t.status_note && (
                  <div style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    background: "#0f0d0a",
                    borderLeft: `2px solid ${statusColor}`,
                    fontSize: 13,
                    color: "#bfb5a8",
                    fontStyle: "italic",
                  }}>
                    <span style={{ fontSize: 9, color: statusColor, letterSpacing: 1.4, textTransform: "uppercase", marginRight: 8 }}>
                      {t.status === "integrated" ? "Identity evidence" : t.status === "disputed" ? "Disputed" : "Dismissed"}
                    </span>
                    {t.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {isResolveOpen && (
                  <div style={{ marginTop: 14, background: "#0f0d0a", border: "1px solid #2a2620", padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                      {(["integrate", "dispute", "dismiss"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setResolveMode(m)}
                          style={{
                            background: resolveMode === m ? (m === "integrate" ? "#7affcb" : m === "dispute" ? "#f4a8a8" : "#9aa28e") : "transparent",
                            color: resolveMode === m ? "#0f0d0a" : "#8a8378",
                            border: `1px solid ${m === "integrate" ? "#7affcb" : m === "dispute" ? "#f4a8a8" : "#9aa28e"}`,
                            padding: "5px 11px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            cursor: "pointer",
                            fontWeight: resolveMode === m ? 600 : 400,
                          }}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder={
                        resolveMode === "integrate"
                          ? "REQUIRED · what this crossing means to you as identity evidence"
                          : resolveMode === "dispute"
                            ? "REQUIRED · how the framing is wrong (what was actually before vs after)"
                            : "optional · why this is a false alarm"
                      }
                      rows={3}
                      style={{
                        width: "100%",
                        background: "#1a1612",
                        border: "1px solid #2a2620",
                        color: "#e8e0d2",
                        padding: "10px 12px",
                        fontSize: 14,
                        fontFamily: resolveMode === "integrate" ? "Georgia, ui-serif, serif" : "ui-sans-serif, system-ui, sans-serif",
                        fontStyle: resolveMode === "integrate" ? "italic" : "normal",
                        resize: "vertical",
                        marginBottom: 10,
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => submitResolve(t)}
                        style={{
                          background: resolveMode === "integrate" ? "#7affcb" : resolveMode === "dispute" ? "#f4a8a8" : "#9aa28e",
                          color: "#0f0d0a",
                          border: "none",
                          padding: "8px 16px",
                          fontSize: 10,
                          letterSpacing: 1.4,
                          textTransform: "uppercase",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => { setResolveOpenId(null); setResolveNote(""); }}
                        style={{
                          background: "transparent",
                          color: "#8a8378",
                          border: "1px solid #2a2620",
                          padding: "8px 14px",
                          fontSize: 10,
                          letterSpacing: 1.4,
                          textTransform: "uppercase",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                {!isResolveOpen && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                    {t.status === "active" ? (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(t.id); setResolveMode("integrate"); setResolveNote(""); }}
                          style={{
                            background: "#7affcb",
                            color: "#0f0d0a",
                            border: "none",
                            padding: "7px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Integrate as evidence
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(t.id); setResolveMode("dispute"); setResolveNote(""); }}
                          style={{
                            background: "transparent",
                            color: "#f4a8a8",
                            border: "1px solid #f4a8a8",
                            padding: "7px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          Dispute the framing
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(t.id); setResolveMode("dismiss"); setResolveNote(""); }}
                          style={{
                            background: "transparent",
                            color: "#9aa28e",
                            border: "1px solid #9aa28e",
                            padding: "7px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          Dismiss
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => patch(t.id, { mode: "unresolve" })}
                        style={{
                          background: "transparent",
                          color: "#bfb5a8",
                          border: "1px solid #2a2620",
                          padding: "7px 12px",
                          fontSize: 10,
                          letterSpacing: 1.4,
                          textTransform: "uppercase",
                          cursor: "pointer",
                        }}
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      onClick={() => patch(t.id, { mode: t.pinned ? "unpin" : "pin" })}
                      style={{
                        background: "transparent",
                        color: t.pinned ? "#fbb86d" : "#8a8378",
                        border: `1px solid ${t.pinned ? "#fbb86d" : "#2a2620"}`,
                        padding: "7px 12px",
                        fontSize: 10,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      {t.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      onClick={() => patch(t.id, { mode: t.archived_at ? "restore" : "archive" })}
                      style={{
                        background: "transparent",
                        color: "#8a8378",
                        border: "1px solid #2a2620",
                        padding: "7px 12px",
                        fontSize: 10,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        cursor: "pointer",
                        marginLeft: "auto",
                      }}
                    >
                      {t.archived_at ? "Restore" : "Archive"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
