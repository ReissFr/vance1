"use client";

import { useCallback, useEffect, useState } from "react";

type Kind = "reaching_out" | "saying_no" | "leaving" | "staying" | "starting" | "quitting" | "spending" | "refusing" | "confronting" | "asking" | "confessing" | "other";
type Tilt = "relief" | "regret" | "mixed";
type Status = "active" | "honoured" | "mourned" | "retried" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterKind = Kind | "all";
type FilterTilt = Tilt | "all";

type Almost = {
  id: string;
  scan_id: string;
  act_text: string;
  pulled_back_by: string;
  consequence_imagined: string | null;
  kind: Kind;
  domain: string;
  weight: number;
  recency: "recent" | "older";
  regret_tilt: Tilt;
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: Status;
  status_note: string | null;
  retry_intention_id: string | null;
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
  honoured: number;
  mourned: number;
  retried: number;
  dismissed: number;
  pinned: number;
  relief: number;
  regret: number;
  mixed: number;
  high_weight: number;
  regret_active: number;
  relief_honoured: number;
  regret_retried: number;
  kind_counts: Record<string, number>;
  tilt_by_kind: Record<string, { relief: number; regret: number; mixed: number }>;
  most_recent_regret: { id: string; spoken_date: string } | null;
  biggest_relief: { id: string; spoken_date: string; weight: number } | null;
  biggest_regret: { id: string; spoken_date: string; weight: number } | null;
};

const KIND_LABEL: Record<Kind, string> = {
  reaching_out: "REACHING OUT",
  saying_no: "SAYING NO",
  leaving: "LEAVING",
  staying: "STAYING",
  starting: "STARTING",
  quitting: "QUITTING",
  spending: "SPENDING",
  refusing: "REFUSING",
  confronting: "CONFRONTING",
  asking: "ASKING",
  confessing: "CONFESSING",
  other: "OTHER",
};

const KIND_COLOR: Record<Kind, string> = {
  reaching_out: "#bfd4ee",
  saying_no: "#fbb86d",
  leaving: "#f4a8a8",
  staying: "#b8c9b8",
  starting: "#7affcb",
  quitting: "#f4577a",
  spending: "#ffd966",
  refusing: "#fbb86d",
  confronting: "#f4a8a8",
  asking: "#bfd4ee",
  confessing: "#c9b3f4",
  other: "#bfb5a8",
};

const TILT_LABEL: Record<Tilt, string> = {
  relief: "RELIEF",
  regret: "REGRET",
  mixed: "MIXED",
};

const TILT_COLOR: Record<Tilt, string> = {
  relief: "#7affcb",
  regret: "#f4577a",
  mixed: "#fbb86d",
};

const TILT_BLURB: Record<Tilt, string> = {
  relief: "the brake was wisdom — thank god you didn't",
  regret: "the brake was fear — you wish you had",
  mixed: "the brake had both sides",
};

const STATUS_COLOR: Record<Status, string> = {
  active: "#bfb5a8",
  honoured: "#7affcb",
  mourned: "#f4a8a8",
  retried: "#fbb86d",
  dismissed: "#9aa28e",
};

const WEIGHT_LABEL: Record<number, string> = {
  1: "FLEETING",
  2: "CONSIDERED",
  3: "DELIBERATED",
  4: "FINGER ON TRIGGER",
  5: "LAST-SECOND REVERSAL",
};

function dotMeter(score: number, color: string): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 6, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function AlmostsConsole() {
  const [rows, setRows] = useState<Almost[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [tiltFilter, setTiltFilter] = useState<FilterTilt>("all");
  const [minWeight, setMinWeight] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [windowDays, setWindowDays] = useState<number>(180);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"honour" | "mourn" | "retry" | "dismiss">("honour");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("kind", kindFilter);
      params.set("regret_tilt", tiltFilter);
      params.set("min_weight", String(minWeight));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "150");
      const r = await fetch(`/api/almosts?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { almosts: Almost[]; stats: Stats };
      setRows(j.almosts);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, tiltFilter, minWeight, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/almosts/scan`, {
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
      const r = await fetch(`/api/almosts/${id}`, {
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

  const submitResolve = async (a: Almost) => {
    setError(null);
    if ((resolveMode === "honour" || resolveMode === "mourn" || resolveMode === "retry") && resolveNote.trim().length < 4) {
      setError(
        resolveMode === "honour" ? "write what made the brake right (4+ chars)"
          : resolveMode === "mourn" ? "write what you'd want back (4+ chars)"
          : "write what you're committing to NOW (4+ chars)",
      );
      return;
    }
    await patch(a.id, { mode: resolveMode, status_note: resolveNote.trim() || undefined });
    setResolveOpenId(null);
    setResolveNote("");
  };

  const resolveColor = (m: "honour" | "mourn" | "retry" | "dismiss"): string =>
    m === "honour" ? "#7affcb"
      : m === "mourn" ? "#f4a8a8"
      : m === "retry" ? "#fbb86d"
      : "#9aa28e";

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} near-misses · ${stats.relief} relief · ${stats.regret} regret · ${stats.high_weight} finger-on-trigger+` : ""}
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
            {scanning ? "Scanning..." : "Scan for near-misses"}
          </button>
        </div>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 18 }}>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #7affcb" }}>
            <div style={{ fontSize: 9, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase" }}>Relief tilts</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.relief}</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #f4577a" }}>
            <div style={{ fontSize: 9, color: "#f4577a", letterSpacing: 1.4, textTransform: "uppercase" }}>Regret tilts</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.regret}</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #fbb86d" }}>
            <div style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>Finger-on-trigger (w &ge; 4)</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.high_weight}</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #fbb86d" }}>
            <div style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>Retried (committed forward)</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.retried}</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Status:</span>
        {(["active", "honoured", "mourned", "retried", "dismissed", "pinned", "archived", "all"] as FilterStatus[]).map((s) => (
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
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Tilt:</span>
        {(["all", "relief", "regret", "mixed"] as FilterTilt[]).map((t) => (
          <button
            key={t}
            onClick={() => setTiltFilter(t)}
            style={{
              background: tiltFilter === t ? "#2a2620" : "transparent",
              border: `1px solid ${tiltFilter === t ? (t === "all" ? "#5a5248" : TILT_COLOR[t as Tilt]) : "#2a2620"}`,
              color: tiltFilter === t ? (t === "all" ? "#e8e0d2" : TILT_COLOR[t as Tilt]) : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Kind:</span>
        {(["all", "reaching_out", "saying_no", "leaving", "staying", "starting", "quitting", "spending", "refusing", "confronting", "asking", "confessing", "other"] as FilterKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            style={{
              background: kindFilter === k ? "#2a2620" : "transparent",
              border: `1px solid ${kindFilter === k ? "#5a5248" : "#2a2620"}`,
              color: kindFilter === k ? "#e8e0d2" : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {k.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Min weight:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setMinWeight(n)}
            style={{
              background: minWeight === n ? "#2a2620" : "transparent",
              border: `1px solid ${minWeight === n ? "#5a5248" : "#2a2620"}`,
              color: minWeight === n ? "#e8e0d2" : "#8a8378",
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
          {scanResult.inserted} new near-miss{scanResult.inserted === 1 ? "" : "es"} surfaced
          {scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 14px", background: "#2a1a1a", border: "1px solid #5a3232", color: "#f4a8a8", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0" }}>Loading near-misses...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0", fontStyle: "italic" }}>
          No near-misses on file for these filters. Run a scan above to surface moments where you almost did it and pulled back.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((a) => {
            const tiltColor = TILT_COLOR[a.regret_tilt];
            const kindColor = KIND_COLOR[a.kind] ?? "#bfb5a8";
            const statusColor = STATUS_COLOR[a.status];
            const leftBorder = a.status === "active" ? tiltColor : statusColor;
            const isResolveOpen = resolveOpenId === a.id;

            return (
              <div key={a.id} style={{
                background: "#1a1612",
                border: "1px solid #2a2620",
                borderLeft: `3px solid ${leftBorder}`,
                padding: "16px 18px",
                opacity: a.status === "dismissed" ? 0.6 : 1,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 22,
                      color: "#e8e0d2",
                      lineHeight: 1.3,
                      fontStyle: "italic",
                    }}>
                      &ldquo;{a.act_text}&rdquo;
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 9,
                        color: tiltColor,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        border: `1px solid ${tiltColor}`,
                        padding: "3px 8px",
                      }}>
                        {TILT_LABEL[a.regret_tilt]}
                      </span>
                      <span style={{
                        fontSize: 9,
                        color: kindColor,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                      }}>
                        {KIND_LABEL[a.kind]}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.2 }}>{WEIGHT_LABEL[a.weight]}</span>
                      {dotMeter(a.weight, tiltColor)}
                    </div>
                    <span style={{ fontSize: 10, color: "#5a5248" }}>
                      {a.spoken_date} · {a.recency}
                    </span>
                  </div>
                </div>

                {/* Pulled-back-by panel */}
                <div style={{
                  marginTop: 14,
                  background: "#0f0d0a",
                  border: "1px solid #2a2620",
                  borderLeft: `2px solid ${tiltColor}`,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>What stopped you</div>
                  <div style={{
                    fontFamily: "Georgia, ui-serif, serif",
                    fontSize: 15,
                    color: "#e8e0d2",
                    lineHeight: 1.5,
                    fontStyle: "italic",
                  }}>
                    {a.pulled_back_by}
                  </div>
                </div>

                {a.consequence_imagined && (
                  <div style={{
                    marginTop: 8,
                    background: "#0f0d0a",
                    border: "1px solid #2a2620",
                    padding: "10px 14px",
                  }}>
                    <div style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>What you imagined</div>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 13,
                      color: "#bfb5a8",
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}>
                      {a.consequence_imagined}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 11, color: "#8a8378", marginTop: 10, fontStyle: "italic" }}>
                  {TILT_BLURB[a.regret_tilt]} · domain · {a.domain}
                </div>

                {a.status !== "active" && a.status_note && (
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
                      {a.status === "honoured" ? "Brake honoured" : a.status === "mourned" ? "Mourned" : a.status === "retried" ? "Retrying now" : "Dismissed"}
                    </span>
                    {a.status_note}
                  </div>
                )}

                {isResolveOpen && (
                  <div style={{ marginTop: 14, background: "#0f0d0a", border: "1px solid #2a2620", padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                      {(["honour", "mourn", "retry", "dismiss"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setResolveMode(m)}
                          style={{
                            background: resolveMode === m ? resolveColor(m) : "transparent",
                            color: resolveMode === m ? "#0f0d0a" : "#8a8378",
                            border: `1px solid ${resolveColor(m)}`,
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
                        resolveMode === "honour"
                          ? "REQUIRED · what made the brake right — what wisdom stopped you"
                          : resolveMode === "mourn"
                            ? "REQUIRED · what you'd want back — why the brake was a self-betrayal"
                            : resolveMode === "retry"
                              ? "REQUIRED · what you're committing to NOW — the action you're taking forward from this near-miss"
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
                        fontFamily: resolveMode === "retry" ? "ui-sans-serif, system-ui, sans-serif" : "Georgia, ui-serif, serif",
                        fontStyle: resolveMode === "retry" ? "normal" : "italic",
                        resize: "vertical",
                        marginBottom: 10,
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => submitResolve(a)}
                        style={{
                          background: resolveColor(resolveMode),
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

                {!isResolveOpen && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                    {a.status === "active" ? (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(a.id); setResolveMode("honour"); setResolveNote(""); }}
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
                          Honour the brake
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(a.id); setResolveMode("mourn"); setResolveNote(""); }}
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
                          Mourn what I almost did
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(a.id); setResolveMode("retry"); setResolveNote(""); }}
                          style={{
                            background: "#fbb86d",
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
                          Try again now
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(a.id); setResolveMode("dismiss"); setResolveNote(""); }}
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
                        onClick={() => patch(a.id, { mode: "unresolve" })}
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
                      onClick={() => patch(a.id, { mode: a.pinned ? "unpin" : "pin" })}
                      style={{
                        background: "transparent",
                        color: a.pinned ? "#fbb86d" : "#8a8378",
                        border: `1px solid ${a.pinned ? "#fbb86d" : "#2a2620"}`,
                        padding: "7px 12px",
                        fontSize: 10,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      {a.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      onClick={() => patch(a.id, { mode: a.archived_at ? "restore" : "archive" })}
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
                      {a.archived_at ? "Restore" : "Archive"}
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
