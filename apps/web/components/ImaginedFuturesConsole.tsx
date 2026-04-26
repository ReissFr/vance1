"use client";

import { useCallback, useEffect, useState } from "react";

type PullKind = "seeking" | "escaping" | "grieving" | "entertaining";
type Status = "active" | "pursuing" | "released" | "sitting_with" | "grieved" | "dismissed";
type Domain = "work" | "health" | "relationships" | "family" | "finance" | "creative" | "self" | "spiritual" | "other";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterPullKind = PullKind | "all";
type FilterDomain = Domain | "all";

type ImaginedFuture = {
  id: string;
  scan_id: string;
  act_text: string;
  future_state: string;
  pull_kind: PullKind;
  domain: Domain;
  weight: number;
  recency: "recent" | "older";
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: Status;
  status_note: string | null;
  pursue_intention_id: string | null;
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
  pursuing: number;
  released: number;
  sitting_with: number;
  grieved: number;
  dismissed: number;
  pinned: number;
  seeking: number;
  escaping: number;
  grieving: number;
  entertaining: number;
  high_weight: number;
  seeking_active: number;
  escaping_active: number;
  grieving_active: number;
  seeking_pursued: number;
  grieving_grieved: number;
  pull_kind_counts: Record<string, number>;
  domain_counts: Record<string, number>;
  kind_by_domain: Record<string, { seeking: number; escaping: number; grieving: number; entertaining: number }>;
  biggest_seeking: { id: string; spoken_date: string; weight: number } | null;
  biggest_escaping: { id: string; spoken_date: string; weight: number } | null;
  most_recent_grieving: { id: string; spoken_date: string } | null;
  most_recent_seeking: { id: string; spoken_date: string } | null;
};

const PULL_KIND_LABEL: Record<PullKind, string> = {
  seeking: "SEEKING",
  escaping: "ESCAPING",
  grieving: "GRIEVING",
  entertaining: "ENTERTAINING",
};

const PULL_KIND_COLOR: Record<PullKind, string> = {
  seeking: "#7affcb",
  escaping: "#fbb86d",
  grieving: "#f4a8a8",
  entertaining: "#9aa28e",
};

const PULL_KIND_BLURB: Record<PullKind, string> = {
  seeking: "a genuine pull — this future is asking to be made real",
  escaping: "a pressure-release valve — the imagining is doing the work",
  grieving: "mourning a path that has already closed",
  entertaining: "curiosity without weight — idle wondering",
};

const STATUS_COLOR: Record<Status, string> = {
  active: "#bfb5a8",
  pursuing: "#7affcb",
  released: "#9aa28e",
  sitting_with: "#c9b3f4",
  grieved: "#f4a8a8",
  dismissed: "#5a5248",
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  pursuing: "Pursuing",
  released: "Released",
  sitting_with: "Sitting with",
  grieved: "Grieved",
  dismissed: "Dismissed",
};

const WEIGHT_LABEL: Record<number, string> = {
  1: "FLEETING",
  2: "RECURRING",
  3: "PERSISTENT",
  4: "VIVID",
  5: "SEARING",
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

export function ImaginedFuturesConsole() {
  const [rows, setRows] = useState<ImaginedFuture[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [pullKindFilter, setPullKindFilter] = useState<FilterPullKind>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minWeight, setMinWeight] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [windowDays, setWindowDays] = useState<number>(180);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"pursue" | "release" | "sitting_with" | "grieve" | "dismiss">("pursue");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("pull_kind", pullKindFilter);
      params.set("domain", domainFilter);
      params.set("min_weight", String(minWeight));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "150");
      const r = await fetch(`/api/imagined-futures?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { imagined_futures: ImaginedFuture[]; stats: Stats };
      setRows(j.imagined_futures);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, pullKindFilter, domainFilter, minWeight, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/imagined-futures/scan`, {
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
      const r = await fetch(`/api/imagined-futures/${id}`, {
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

  const submitResolve = async (f: ImaginedFuture) => {
    setError(null);
    if ((resolveMode === "pursue" || resolveMode === "release" || resolveMode === "grieve") && resolveNote.trim().length < 4) {
      setError(
        resolveMode === "pursue" ? "write the first concrete step you're taking (4+ chars)"
          : resolveMode === "release" ? "write what releases you from this (4+ chars)"
          : "write what you're mourning (4+ chars)",
      );
      return;
    }
    await patch(f.id, { mode: resolveMode, status_note: resolveNote.trim() || undefined });
    setResolveOpenId(null);
    setResolveNote("");
  };

  const resolveColor = (m: "pursue" | "release" | "sitting_with" | "grieve" | "dismiss"): string =>
    m === "pursue" ? "#7affcb"
      : m === "release" ? "#9aa28e"
      : m === "sitting_with" ? "#c9b3f4"
      : m === "grieve" ? "#f4a8a8"
      : "#5a5248";

  const resolveLabel = (m: "pursue" | "release" | "sitting_with" | "grieve" | "dismiss"): string =>
    m === "sitting_with" ? "sit with" : m;

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} futures · ${stats.seeking_active} seeking · ${stats.escaping_active} escaping · ${stats.high_weight} vivid+` : ""}
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
            {scanning ? "Scanning..." : "Scan for imagined futures"}
          </button>
        </div>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 18 }}>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #7affcb" }}>
            <div style={{ fontSize: 9, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase" }}>Seeking active</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.seeking_active}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>genuine pulls — unpursued</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #fbb86d" }}>
            <div style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>Escaping active</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.escaping_active}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>pressure-release valves</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #f4a8a8" }}>
            <div style={{ fontSize: 9, color: "#f4a8a8", letterSpacing: 1.4, textTransform: "uppercase" }}>Grieving active</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.grieving_active}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>closed paths still aching</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #7affcb" }}>
            <div style={{ fontSize: 9, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase" }}>Pursued (made real)</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.seeking_pursued}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>seeking → present step</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Status:</span>
        {(["active", "pursuing", "released", "sitting_with", "grieved", "dismissed", "pinned", "archived", "all"] as FilterStatus[]).map((s) => (
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
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Pull:</span>
        {(["all", "seeking", "escaping", "grieving", "entertaining"] as FilterPullKind[]).map((p) => (
          <button
            key={p}
            onClick={() => setPullKindFilter(p)}
            style={{
              background: pullKindFilter === p ? "#2a2620" : "transparent",
              border: `1px solid ${pullKindFilter === p ? (p === "all" ? "#5a5248" : PULL_KIND_COLOR[p as PullKind]) : "#2a2620"}`,
              color: pullKindFilter === p ? (p === "all" ? "#e8e0d2" : PULL_KIND_COLOR[p as PullKind]) : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {p}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Domain:</span>
        {(["all", "work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"] as FilterDomain[]).map((d) => (
          <button
            key={d}
            onClick={() => setDomainFilter(d)}
            style={{
              background: domainFilter === d ? "#2a2620" : "transparent",
              border: `1px solid ${domainFilter === d ? "#5a5248" : "#2a2620"}`,
              color: domainFilter === d ? "#e8e0d2" : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {d}
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
          {scanResult.inserted} new imagined future{scanResult.inserted === 1 ? "" : "s"} surfaced
          {scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 14px", background: "#2a1a1a", border: "1px solid #5a3232", color: "#f4a8a8", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0" }}>Loading imagined futures...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0", fontStyle: "italic" }}>
          No imagined futures on file for these filters. Run a scan above to surface the futures you've been visiting mentally.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((f) => {
            const pullColor = PULL_KIND_COLOR[f.pull_kind];
            const statusColor = STATUS_COLOR[f.status];
            const leftBorder = f.status === "active" ? pullColor : statusColor;
            const isResolveOpen = resolveOpenId === f.id;

            return (
              <div key={f.id} style={{
                background: "#1a1612",
                border: "1px solid #2a2620",
                borderLeft: `3px solid ${leftBorder}`,
                padding: "16px 18px",
                opacity: f.status === "dismissed" ? 0.6 : 1,
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
                      &ldquo;{f.act_text}&rdquo;
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 9,
                        color: pullColor,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        border: `1px solid ${pullColor}`,
                        padding: "3px 8px",
                      }}>
                        {PULL_KIND_LABEL[f.pull_kind]}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.2 }}>{WEIGHT_LABEL[f.weight]}</span>
                      {dotMeter(f.weight, pullColor)}
                    </div>
                    <span style={{ fontSize: 10, color: "#5a5248" }}>
                      {f.spoken_date} · {f.recency}
                    </span>
                  </div>
                </div>

                {/* Future-state panel */}
                <div style={{
                  marginTop: 14,
                  background: "#0f0d0a",
                  border: "1px solid #2a2620",
                  borderLeft: `2px solid ${pullColor}`,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>What the future looks like</div>
                  <div style={{
                    fontFamily: "Georgia, ui-serif, serif",
                    fontSize: 15,
                    color: "#e8e0d2",
                    lineHeight: 1.5,
                    fontStyle: "italic",
                  }}>
                    {f.future_state}
                  </div>
                </div>

                <div style={{ fontSize: 11, color: "#8a8378", marginTop: 10, fontStyle: "italic" }}>
                  {PULL_KIND_BLURB[f.pull_kind]} · domain · {f.domain}
                </div>

                {f.status !== "active" && f.status_note && (
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
                      {STATUS_LABEL[f.status]}
                    </span>
                    {f.status_note}
                  </div>
                )}

                {isResolveOpen && (
                  <div style={{ marginTop: 14, background: "#0f0d0a", border: "1px solid #2a2620", padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                      {(["pursue", "release", "sitting_with", "grieve", "dismiss"] as const).map((m) => (
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
                          {resolveLabel(m)}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder={
                        resolveMode === "pursue"
                          ? "REQUIRED · the first concrete step you're taking — what makes this future real now"
                          : resolveMode === "release"
                            ? "REQUIRED · what releases you from this — what makes letting go right"
                            : resolveMode === "sitting_with"
                              ? "optional · why this stays alive without forcing a decision"
                              : resolveMode === "grieve"
                                ? "REQUIRED · what you're mourning — the version of you that won't get to live this"
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
                        fontFamily: resolveMode === "pursue" ? "ui-sans-serif, system-ui, sans-serif" : "Georgia, ui-serif, serif",
                        fontStyle: resolveMode === "pursue" ? "normal" : "italic",
                        resize: "vertical",
                        marginBottom: 10,
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => submitResolve(f)}
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
                    {f.status === "active" ? (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(f.id); setResolveMode("pursue"); setResolveNote(""); }}
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
                          Pursue
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(f.id); setResolveMode("release"); setResolveNote(""); }}
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
                          Release
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(f.id); setResolveMode("sitting_with"); setResolveNote(""); }}
                          style={{
                            background: "transparent",
                            color: "#c9b3f4",
                            border: "1px solid #c9b3f4",
                            padding: "7px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          Sit with
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(f.id); setResolveMode("grieve"); setResolveNote(""); }}
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
                          Grieve
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(f.id); setResolveMode("dismiss"); setResolveNote(""); }}
                          style={{
                            background: "transparent",
                            color: "#5a5248",
                            border: "1px solid #5a5248",
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
                        onClick={() => patch(f.id, { mode: "unresolve" })}
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
                      onClick={() => patch(f.id, { mode: f.pinned ? "unpin" : "pin" })}
                      style={{
                        background: "transparent",
                        color: f.pinned ? "#fbb86d" : "#8a8378",
                        border: `1px solid ${f.pinned ? "#fbb86d" : "#2a2620"}`,
                        padding: "7px 12px",
                        fontSize: 10,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      {f.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      onClick={() => patch(f.id, { mode: f.archived_at ? "restore" : "archive" })}
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
                      {f.archived_at ? "Restore" : "Archive"}
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
