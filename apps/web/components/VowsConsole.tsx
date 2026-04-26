"use client";

import { useCallback, useEffect, useState } from "react";

type VowAge = "childhood" | "adolescent" | "early_adult" | "adult" | "recent" | "unknown";
type Status = "active" | "renewed" | "revised" | "released" | "honoured" | "dismissed";
type Domain = "work" | "health" | "relationships" | "family" | "finance" | "creative" | "self" | "spiritual" | "other";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterAge = VowAge | "all";
type FilterDomain = Domain | "all";

type Vow = {
  id: string;
  scan_id: string;
  vow_text: string;
  shadow: string;
  origin_event: string | null;
  vow_age: VowAge;
  domain: Domain;
  weight: number;
  recency: "recent" | "older";
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: Status;
  status_note: string | null;
  revised_to: string | null;
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
  renewed: number;
  revised: number;
  released: number;
  honoured: number;
  dismissed: number;
  pinned: number;
  childhood: number;
  adolescent: number;
  early_adult: number;
  adult: number;
  recent: number;
  unknown_age: number;
  high_weight: number;
  organizing_principles: number;
  unexamined_childhood: number;
  unexamined_adolescent: number;
  revised_count: number;
  released_count: number;
  vow_age_counts: Record<string, number>;
  domain_counts: Record<string, number>;
  age_by_domain: Record<string, { childhood: number; adolescent: number; early_adult: number; adult: number; recent: number; unknown: number }>;
  biggest_active: { id: string; spoken_date: string; weight: number } | null;
  oldest_unexamined: { id: string; vow_age: string; weight: number } | null;
  most_recent_released: { id: string; spoken_date: string } | null;
};

const VOW_AGE_LABEL: Record<VowAge, string> = {
  childhood: "CHILDHOOD",
  adolescent: "ADOLESCENT",
  early_adult: "EARLY ADULT",
  adult: "ADULT",
  recent: "RECENT",
  unknown: "UNKNOWN",
};

const VOW_AGE_COLOR: Record<VowAge, string> = {
  childhood: "#f4577a",
  adolescent: "#f4a8a8",
  early_adult: "#fbb86d",
  adult: "#7affcb",
  recent: "#bfd4ee",
  unknown: "#9aa28e",
};

const VOW_AGE_BLURB: Record<VowAge, string> = {
  childhood: "forged before adolescence — most likely obsolete, most likely load-bearing",
  adolescent: "forged in teenage years — re-examine",
  early_adult: "forged in your 20s",
  adult: "forged in mature life",
  recent: "forged recently",
  unknown: "origin not stated",
};

const STATUS_COLOR: Record<Status, string> = {
  active: "#bfb5a8",
  renewed: "#7affcb",
  revised: "#fbb86d",
  released: "#9aa28e",
  honoured: "#c9b3f4",
  dismissed: "#5a5248",
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  renewed: "Renewed",
  revised: "Revised",
  released: "Released",
  honoured: "Honoured (cost noted)",
  dismissed: "Dismissed",
};

const WEIGHT_LABEL: Record<number, string> = {
  1: "PASSING",
  2: "OPERATIVE",
  3: "PRINCIPLE",
  4: "LOAD-BEARING",
  5: "ORGANIZING",
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

export function VowsConsole() {
  const [rows, setRows] = useState<Vow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [ageFilter, setAgeFilter] = useState<FilterAge>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minWeight, setMinWeight] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [windowDays, setWindowDays] = useState<number>(365);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"renew" | "revise" | "release" | "honour" | "dismiss">("renew");
  const [resolveNote, setResolveNote] = useState("");
  const [resolveRevised, setResolveRevised] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("vow_age", ageFilter);
      params.set("domain", domainFilter);
      params.set("min_weight", String(minWeight));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "150");
      const r = await fetch(`/api/vows?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { vows: Vow[]; stats: Stats };
      setRows(j.vows);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, ageFilter, domainFilter, minWeight, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/vows/scan`, {
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
      const r = await fetch(`/api/vows/${id}`, {
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

  const submitResolve = async (v: Vow) => {
    setError(null);
    if ((resolveMode === "renew" || resolveMode === "release" || resolveMode === "honour") && resolveNote.trim().length < 4) {
      setError(
        resolveMode === "renew" ? "write why this vow still holds (4+ chars)"
          : resolveMode === "release" ? "write what this vow protected and why you no longer need it (4+ chars)"
          : "write what the cost is and why you keep it anyway (4+ chars)",
      );
      return;
    }
    if (resolveMode === "revise") {
      if (resolveNote.trim().length < 4) {
        setError("write why the spirit holds but the letter needs updating (4+ chars)");
        return;
      }
      if (resolveRevised.trim().length < 4) {
        setError("write the new vow text replacing the old (4+ chars)");
        return;
      }
    }
    const body: Record<string, unknown> = { mode: resolveMode };
    if (resolveMode !== "dismiss") body.status_note = resolveNote.trim();
    else if (resolveNote.trim()) body.status_note = resolveNote.trim();
    if (resolveMode === "revise") body.revised_to = resolveRevised.trim();
    await patch(v.id, body);
    setResolveOpenId(null);
    setResolveNote("");
    setResolveRevised("");
  };

  const resolveColor = (m: "renew" | "revise" | "release" | "honour" | "dismiss"): string =>
    m === "renew" ? "#7affcb"
      : m === "revise" ? "#fbb86d"
      : m === "release" ? "#9aa28e"
      : m === "honour" ? "#c9b3f4"
      : "#5a5248";

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} vows · ${stats.unexamined_childhood} unexamined childhood · ${stats.organizing_principles} organizing principles` : ""}
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
            {scanning ? "Scanning..." : "Scan for vows"}
          </button>
        </div>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 18 }}>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #f4577a" }}>
            <div style={{ fontSize: 9, color: "#f4577a", letterSpacing: 1.4, textTransform: "uppercase" }}>Unexamined childhood</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.unexamined_childhood}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>active vows from before adolescence</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #f4a8a8" }}>
            <div style={{ fontSize: 9, color: "#f4a8a8", letterSpacing: 1.4, textTransform: "uppercase" }}>Unexamined adolescent</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.unexamined_adolescent}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>active vows from teen years</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #fbb86d" }}>
            <div style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>Organizing principles</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.organizing_principles}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>weight=5 — identity-level vows</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #9aa28e" }}>
            <div style={{ fontSize: 9, color: "#9aa28e", letterSpacing: 1.4, textTransform: "uppercase" }}>Released</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.released_count}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>vows you've explicitly let go</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Status:</span>
        {(["active", "renewed", "revised", "released", "honoured", "dismissed", "pinned", "archived", "all"] as FilterStatus[]).map((s) => (
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
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Age:</span>
        {(["all", "childhood", "adolescent", "early_adult", "adult", "recent", "unknown"] as FilterAge[]).map((a) => (
          <button
            key={a}
            onClick={() => setAgeFilter(a)}
            style={{
              background: ageFilter === a ? "#2a2620" : "transparent",
              border: `1px solid ${ageFilter === a ? (a === "all" ? "#5a5248" : VOW_AGE_COLOR[a as VowAge]) : "#2a2620"}`,
              color: ageFilter === a ? (a === "all" ? "#e8e0d2" : VOW_AGE_COLOR[a as VowAge]) : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {a.replace(/_/g, " ")}
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
          {scanResult.inserted} new vow{scanResult.inserted === 1 ? "" : "s"} surfaced
          {scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 14px", background: "#2a1a1a", border: "1px solid #5a3232", color: "#f4a8a8", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0" }}>Loading vows...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0", fontStyle: "italic" }}>
          No vows on file for these filters. Run a scan above to surface promises you've made to yourself.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((v) => {
            const ageColor = VOW_AGE_COLOR[v.vow_age];
            const statusColor = STATUS_COLOR[v.status];
            const leftBorder = v.status === "active" ? ageColor : statusColor;
            const isResolveOpen = resolveOpenId === v.id;

            return (
              <div key={v.id} style={{
                background: "#1a1612",
                border: "1px solid #2a2620",
                borderLeft: `3px solid ${leftBorder}`,
                padding: "16px 18px",
                opacity: v.status === "dismissed" ? 0.6 : 1,
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
                      &ldquo;{v.vow_text}&rdquo;
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 9,
                        color: ageColor,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        border: `1px solid ${ageColor}`,
                        padding: "3px 8px",
                      }}>
                        {VOW_AGE_LABEL[v.vow_age]}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.2 }}>{WEIGHT_LABEL[v.weight]}</span>
                      {dotMeter(v.weight, ageColor)}
                    </div>
                    <span style={{ fontSize: 10, color: "#5a5248" }}>
                      {v.spoken_date} · {v.recency}
                    </span>
                  </div>
                </div>

                {/* Shadow panel — the novel diagnostic */}
                <div style={{
                  marginTop: 14,
                  background: "#0f0d0a",
                  border: "1px solid #2a2620",
                  borderLeft: "2px solid #f4577a",
                  padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 9, color: "#f4577a", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>The shadow — what this rules out</div>
                  <div style={{
                    fontFamily: "Georgia, ui-serif, serif",
                    fontSize: 15,
                    color: "#e8e0d2",
                    lineHeight: 1.5,
                    fontStyle: "italic",
                  }}>
                    {v.shadow}
                  </div>
                </div>

                {v.origin_event && (
                  <div style={{
                    marginTop: 8,
                    background: "#0f0d0a",
                    border: "1px solid #2a2620",
                    padding: "10px 14px",
                  }}>
                    <div style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>Origin event</div>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 13,
                      color: "#bfb5a8",
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}>
                      {v.origin_event}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 11, color: "#8a8378", marginTop: 10, fontStyle: "italic" }}>
                  {VOW_AGE_BLURB[v.vow_age]} · domain · {v.domain}
                </div>

                {v.status === "revised" && v.revised_to && (
                  <div style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    background: "#0f0d0a",
                    borderLeft: "2px solid #fbb86d",
                    fontSize: 14,
                    color: "#e8e0d2",
                    fontFamily: "Georgia, ui-serif, serif",
                    fontStyle: "italic",
                  }}>
                    <span style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase", marginRight: 8, fontStyle: "normal", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
                      Revised to
                    </span>
                    &ldquo;{v.revised_to}&rdquo;
                  </div>
                )}

                {v.status !== "active" && v.status_note && (
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
                      {STATUS_LABEL[v.status]}
                    </span>
                    {v.status_note}
                  </div>
                )}

                {isResolveOpen && (
                  <div style={{ marginTop: 14, background: "#0f0d0a", border: "1px solid #2a2620", padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                      {(["renew", "revise", "release", "honour", "dismiss"] as const).map((m) => (
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
                        resolveMode === "renew"
                          ? "REQUIRED · why this vow still holds — re-author it as still mine"
                          : resolveMode === "revise"
                            ? "REQUIRED · why the spirit holds but the letter needs updating"
                            : resolveMode === "release"
                              ? "REQUIRED · what this vow protected and why you no longer need it"
                              : resolveMode === "honour"
                                ? "REQUIRED · what the cost is and why you keep it anyway"
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
                        fontFamily: resolveMode === "revise" ? "ui-sans-serif, system-ui, sans-serif" : "Georgia, ui-serif, serif",
                        fontStyle: resolveMode === "revise" ? "normal" : "italic",
                        resize: "vertical",
                        marginBottom: 10,
                      }}
                    />
                    {resolveMode === "revise" && (
                      <textarea
                        value={resolveRevised}
                        onChange={(e) => setResolveRevised(e.target.value)}
                        placeholder="REQUIRED · the new vow text replacing the old (e.g. 'I ask for help when something is genuinely beyond me, otherwise I figure it out myself')"
                        rows={2}
                        style={{
                          width: "100%",
                          background: "#1a1612",
                          border: "1px solid #fbb86d",
                          color: "#e8e0d2",
                          padding: "10px 12px",
                          fontSize: 16,
                          fontFamily: "Georgia, ui-serif, serif",
                          fontStyle: "italic",
                          resize: "vertical",
                          marginBottom: 10,
                        }}
                      />
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => submitResolve(v)}
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
                        onClick={() => { setResolveOpenId(null); setResolveNote(""); setResolveRevised(""); }}
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
                    {v.status === "active" ? (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(v.id); setResolveMode("renew"); setResolveNote(""); setResolveRevised(""); }}
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
                          Renew
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(v.id); setResolveMode("revise"); setResolveNote(""); setResolveRevised(""); }}
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
                          Revise
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(v.id); setResolveMode("release"); setResolveNote(""); setResolveRevised(""); }}
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
                          onClick={() => { setResolveOpenId(v.id); setResolveMode("honour"); setResolveNote(""); setResolveRevised(""); }}
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
                          Honour (cost noted)
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(v.id); setResolveMode("dismiss"); setResolveNote(""); setResolveRevised(""); }}
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
                        onClick={() => patch(v.id, { mode: "unresolve" })}
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
                      onClick={() => patch(v.id, { mode: v.pinned ? "unpin" : "pin" })}
                      style={{
                        background: "transparent",
                        color: v.pinned ? "#fbb86d" : "#8a8378",
                        border: `1px solid ${v.pinned ? "#fbb86d" : "#2a2620"}`,
                        padding: "7px 12px",
                        fontSize: 10,
                        letterSpacing: 1.4,
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      {v.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      onClick={() => patch(v.id, { mode: v.archived_at ? "restore" : "archive" })}
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
                      {v.archived_at ? "Restore" : "Archive"}
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
