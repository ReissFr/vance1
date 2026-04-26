"use client";

import { useCallback, useEffect, useState } from "react";

type LoopKind =
  | "question" | "fear" | "problem" | "fantasy" | "scene_replay"
  | "grievance" | "craving" | "regret_gnaw" | "other";
type Domain =
  | "work" | "health" | "relationships" | "family" | "finance"
  | "creative" | "self" | "spiritual" | "other";
type Velocity = "escalating" | "stable" | "dampening" | "dormant";
type Status = "active" | "broken" | "widened" | "settled" | "archived" | "dismissed";

type FilterStatus = Status | "pinned" | "all";
type FilterKind = LoopKind | "all";
type FilterDomain = Domain | "all";
type FilterVelocity = Velocity | "all";

type Loop = {
  id: string;
  scan_id: string;
  topic_text: string;
  loop_kind: LoopKind;
  domain: Domain;
  first_seen_date: string;
  last_seen_date: string;
  occurrence_count: number;
  distinct_chat_count: number;
  chronicity_days: number;
  amplitude: number;
  velocity: Velocity;
  confidence: number;
  evidence_message_ids: string[];
  status: Status;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  active: number;
  broken: number;
  widened: number;
  settled: number;
  dismissed: number;
  pinned: number;
  chronic_active: number;
  escalating_active: number;
  dormant_active: number;
  avg_amplitude_active: number;
  avg_chronicity_active: number;
  biggest_active_amplitude: number;
  by_kind: Record<string, number>;
  by_domain: Record<string, number>;
  by_velocity: Record<string, number>;
};

const KIND_LABEL: Record<LoopKind, string> = {
  question: "QUESTION",
  fear: "FEAR",
  problem: "PROBLEM",
  fantasy: "FANTASY",
  scene_replay: "SCENE REPLAY",
  grievance: "GRIEVANCE",
  craving: "CRAVING",
  regret_gnaw: "REGRET",
  other: "OTHER",
};

const KIND_COLOR: Record<LoopKind, string> = {
  question: "#bfd4ee",
  fear: "#f4577a",
  problem: "#fbb86d",
  fantasy: "#c9b3f4",
  scene_replay: "#f4a8a8",
  grievance: "#f4577a",
  craving: "#fbb86d",
  regret_gnaw: "#c9b3f4",
  other: "#9aa28e",
};

const KIND_BLURB: Record<LoopKind, string> = {
  question: "an open question you keep returning to",
  fear: "a dread that re-surfaces",
  problem: "a perceived broken-ness you keep naming",
  fantasy: "an imagined scene that recurs without action",
  scene_replay: "a moment you keep replaying",
  grievance: "what someone did, replayed",
  craving: "a desire that returns and is not chosen",
  regret_gnaw: "a thing you keep wishing you'd done",
  other: "uncategorised loop",
};

const VELOCITY_COLOR: Record<Velocity, string> = {
  escalating: "#fbb86d",
  stable: "#7affcb",
  dampening: "#9aa28e",
  dormant: "#bfb5a8",
};

const VELOCITY_LABEL: Record<Velocity, string> = {
  escalating: "ESCALATING",
  stable: "STABLE",
  dampening: "DAMPENING",
  dormant: "DORMANT",
};

const STATUS_COLOR: Record<Status, string> = {
  active: "#bfb5a8",
  broken: "#7affcb",
  widened: "#fbb86d",
  settled: "#c9b3f4",
  archived: "#5a5248",
  dismissed: "#5a5248",
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  broken: "Broken",
  widened: "Widened",
  settled: "Settled",
  archived: "Archived",
  dismissed: "Dismissed",
};

const AMPLITUDE_LABEL: Record<number, string> = {
  1: "PASSING",
  2: "PRESENT",
  3: "WEIGHTED",
  4: "HEAVY",
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

function relativeDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export function LoopsRegisterConsole() {
  const [rows, setRows] = useState<Loop[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [velocityFilter, setVelocityFilter] = useState<FilterVelocity>("all");
  const [minAmplitude, setMinAmplitude] = useState<number>(1);
  const [minChronicity, setMinChronicity] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; updated?: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [windowDays, setWindowDays] = useState<number>(365);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"break" | "widen" | "settle" | "archive" | "dismiss">("break");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter === "pinned") {
        params.set("pinned", "true");
      } else if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (statusFilter === "archived" || statusFilter === "all") params.set("include_archived", "true");
      if (kindFilter !== "all") params.set("kind", kindFilter);
      if (domainFilter !== "all") params.set("domain", domainFilter);
      if (velocityFilter !== "all") params.set("velocity", velocityFilter);
      if (minAmplitude > 1) params.set("min_amplitude", String(minAmplitude));
      if (minChronicity > 0) params.set("min_chronicity_days", String(minChronicity));
      params.set("limit", "200");
      const r = await fetch(`/api/loops-register?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { loops: Loop[]; stats: Stats };
      setRows(j.loops);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, domainFilter, velocityFilter, minAmplitude, minChronicity]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/loops-register/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; updated?: number; latency_ms?: number; signals?: Record<string, number> };
      setScanResult({ inserted: j.inserted, updated: j.updated, latency_ms: j.latency_ms, signals: j.signals });
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
      const r = await fetch(`/api/loops-register/${id}`, {
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

  const submitResolve = async (loop: Loop) => {
    setError(null);
    if ((resolveMode === "break" || resolveMode === "widen" || resolveMode === "settle") && resolveNote.trim().length < 4) {
      setError(
        resolveMode === "break" ? "write what specific commitment ends this loop (4+ chars)"
          : resolveMode === "widen" ? "write the new information that reframes this loop (4+ chars)"
          : "write why this loop is care, not a problem to solve (4+ chars)",
      );
      return;
    }
    const body: Record<string, unknown> = { action: resolveMode };
    if (resolveMode !== "archive") {
      if (resolveNote.trim()) body.status_note = resolveNote.trim();
    }
    await patch(loop.id, body);
    setResolveOpenId(null);
    setResolveNote("");
  };

  const resolveColor = (m: "break" | "widen" | "settle" | "archive" | "dismiss"): string =>
    m === "break" ? "#7affcb"
      : m === "widen" ? "#fbb86d"
      : m === "settle" ? "#c9b3f4"
      : m === "archive" ? "#9aa28e"
      : "#5a5248";

  const resolveLabel = (m: "break" | "widen" | "settle" | "archive" | "dismiss"): string =>
    m === "break" ? "Break"
      : m === "widen" ? "Widen"
      : m === "settle" ? "Settle"
      : m === "archive" ? "Archive"
      : "Dismiss";

  const resolveBlurb = (m: "break" | "widen" | "settle" | "archive" | "dismiss"): string =>
    m === "break" ? "commit to something that ends the loop"
      : m === "widen" ? "introduce new information; the loop reframes"
      : m === "settle" ? "accept this as care — not a problem to fix"
      : m === "archive" ? "soft-hide this loop"
      : "false positive from the scan";

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} loops · ${stats.chronic_active} chronic active · ${stats.escalating_active} escalating` : ""}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
            style={{ background: "#1a1612", border: "1px solid #2a2620", color: "#e8e0d2", padding: "6px 10px", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" }}
          >
            <option value={90}>90d window</option>
            <option value={180}>180d window</option>
            <option value={365}>1y window</option>
            <option value={730}>2y window</option>
          </select>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{ background: scanning ? "#2a2620" : "#7affcb", color: scanning ? "#8a8378" : "#0f0d0a", border: "none", padding: "8px 18px", fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 600, cursor: scanning ? "default" : "pointer" }}
          >
            {scanning ? "Mining loops..." : "Mine for loops"}
          </button>
        </div>
      </div>

      {scanResult && (
        <div style={{ background: "#1a1612", border: "1px solid #2a2620", borderLeft: "3px solid #7affcb", padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#bfb5a8", letterSpacing: 1.2 }}>
          {scanResult.inserted} new · {scanResult.updated ?? 0} updated{scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}{scanResult.signals ? ` · sampled ${scanResult.signals.sampled} · emitted ${scanResult.signals.emitted}` : ""}
        </div>
      )}

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 18 }}>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #f4577a" }}>
            <div style={{ fontSize: 9, color: "#f4577a", letterSpacing: 1.4, textTransform: "uppercase" }}>Chronic active</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.chronic_active}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>active loops over 6mo old</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #fbb86d" }}>
            <div style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>Escalating</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.escalating_active}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>more frequent / intense lately</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #c9b3f4" }}>
            <div style={{ fontSize: 9, color: "#c9b3f4", letterSpacing: 1.4, textTransform: "uppercase" }}>Settled</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.settled}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>care, not problems to fix</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #7affcb" }}>
            <div style={{ fontSize: 9, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase" }}>Broken / widened</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.broken + stats.widened}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>loops you've moved through</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #bfd4ee" }}>
            <div style={{ fontSize: 9, color: "#bfd4ee", letterSpacing: 1.4, textTransform: "uppercase" }}>Avg chronicity</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.avg_chronicity_active}d</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>active loops, average days</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Status:</span>
        {(["active", "broken", "widened", "settled", "dismissed", "archived", "pinned", "all"] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{ background: statusFilter === s ? "#2a2620" : "transparent", border: `1px solid ${statusFilter === s ? "#5a5248" : "#2a2620"}`, color: statusFilter === s ? "#e8e0d2" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Kind:</span>
        {(["all", "question", "fear", "problem", "fantasy", "scene_replay", "grievance", "craving", "regret_gnaw", "other"] as FilterKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            style={{ background: kindFilter === k ? "#2a2620" : "transparent", border: `1px solid ${kindFilter === k ? (k === "all" ? "#5a5248" : KIND_COLOR[k as LoopKind]) : "#2a2620"}`, color: kindFilter === k ? (k === "all" ? "#e8e0d2" : KIND_COLOR[k as LoopKind]) : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {k.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Velocity:</span>
        {(["all", "escalating", "stable", "dampening", "dormant"] as FilterVelocity[]).map((v) => (
          <button
            key={v}
            onClick={() => setVelocityFilter(v)}
            style={{ background: velocityFilter === v ? "#2a2620" : "transparent", border: `1px solid ${velocityFilter === v ? (v === "all" ? "#5a5248" : VELOCITY_COLOR[v as Velocity]) : "#2a2620"}`, color: velocityFilter === v ? (v === "all" ? "#e8e0d2" : VELOCITY_COLOR[v as Velocity]) : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {v}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Domain:</span>
        {(["all", "work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"] as FilterDomain[]).map((d) => (
          <button
            key={d}
            onClick={() => setDomainFilter(d)}
            style={{ background: domainFilter === d ? "#2a2620" : "transparent", border: `1px solid ${domainFilter === d ? "#5a5248" : "#2a2620"}`, color: domainFilter === d ? "#e8e0d2" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {d}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Min amp:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setMinAmplitude(n)}
            style={{ background: minAmplitude === n ? "#2a2620" : "transparent", border: `1px solid ${minAmplitude === n ? "#5a5248" : "#2a2620"}`, color: minAmplitude === n ? "#e8e0d2" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {n}+
          </button>
        ))}
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginLeft: 12 }}>Min chronicity:</span>
        {[0, 30, 90, 180, 365].map((n) => (
          <button
            key={n}
            onClick={() => setMinChronicity(n)}
            style={{ background: minChronicity === n ? "#2a2620" : "transparent", border: `1px solid ${minChronicity === n ? "#5a5248" : "#2a2620"}`, color: minChronicity === n ? "#e8e0d2" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {n === 0 ? "any" : `${n}d+`}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: "#1a1612", border: "1px solid #f4577a", color: "#f4577a", padding: "10px 14px", marginBottom: 14, fontSize: 11, letterSpacing: 1.2 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 11, color: "#5a5248", letterSpacing: 1.4, textTransform: "uppercase" }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "30px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#8a8378", fontStyle: "italic", marginBottom: 8 }}>
            No loops match these filters yet.
          </div>
          <div style={{ fontSize: 11, color: "#5a5248", letterSpacing: 1.2 }}>
            Run "Mine for loops" to scan your chat history for recurring concerns.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((loop) => {
            const kindColor = KIND_COLOR[loop.loop_kind];
            const velColor = VELOCITY_COLOR[loop.velocity];
            const isResolving = resolveOpenId === loop.id;
            return (
              <div
                key={loop.id}
                style={{ background: "#1a1612", border: "1px solid #2a2620", borderLeft: `3px solid ${velColor}`, padding: "14px 16px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 9, color: kindColor, letterSpacing: 1.4, textTransform: "uppercase", border: `1px solid ${kindColor}33`, padding: "2px 6px" }}>
                        {KIND_LABEL[loop.loop_kind]}
                      </span>
                      <span style={{ fontSize: 9, color: velColor, letterSpacing: 1.4, textTransform: "uppercase", border: `1px solid ${velColor}33`, padding: "2px 6px" }}>
                        {VELOCITY_LABEL[loop.velocity]}
                      </span>
                      <span style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.2, textTransform: "uppercase" }}>
                        {loop.domain}
                      </span>
                      {loop.pinned && (
                        <span style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>● pinned</span>
                      )}
                      <span style={{ fontSize: 9, color: STATUS_COLOR[loop.status], letterSpacing: 1.4, textTransform: "uppercase" }}>
                        {STATUS_LABEL[loop.status]}
                      </span>
                    </div>
                    <div style={{ fontSize: 19, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", fontStyle: "italic", lineHeight: 1.35 }}>
                      {loop.topic_text}
                    </div>
                    <div style={{ fontSize: 10, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>
                      {KIND_BLURB[loop.loop_kind]}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <div style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.2, textTransform: "uppercase" }}>
                      AMP {AMPLITUDE_LABEL[loop.amplitude]}
                    </div>
                    {dotMeter(loop.amplitude, kindColor)}
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 10, color: "#8a8378", letterSpacing: 1.1, marginBottom: 8 }}>
                  <span>first seen <span style={{ color: "#bfb5a8" }}>{relativeDate(loop.first_seen_date)}</span></span>
                  <span>last seen <span style={{ color: "#bfb5a8" }}>{relativeDate(loop.last_seen_date)}</span></span>
                  <span><span style={{ color: "#bfb5a8" }}>{loop.occurrence_count}</span> occurrences</span>
                  <span><span style={{ color: "#bfb5a8" }}>{loop.distinct_chat_count}</span> chats</span>
                  <span>chronicity <span style={{ color: "#bfb5a8" }}>{loop.chronicity_days}d</span></span>
                </div>

                {loop.status_note && (
                  <div style={{ background: "#0f0d0a", border: `1px solid ${STATUS_COLOR[loop.status]}33`, padding: "8px 12px", marginBottom: 8, fontSize: 12, color: "#bfb5a8", fontStyle: "italic", lineHeight: 1.4 }}>
                    <span style={{ fontSize: 8, color: STATUS_COLOR[loop.status], letterSpacing: 1.4, textTransform: "uppercase", display: "block", marginBottom: 2 }}>{STATUS_LABEL[loop.status]} note</span>
                    {loop.status_note}
                  </div>
                )}

                {!isResolving ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {loop.status === "active" ? (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(loop.id); setResolveMode("break"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #7affcb55", color: "#7affcb", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Break
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(loop.id); setResolveMode("widen"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #fbb86d55", color: "#fbb86d", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Widen
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(loop.id); setResolveMode("settle"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #c9b3f455", color: "#c9b3f4", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Settle
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(loop.id); setResolveMode("archive"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #9aa28e55", color: "#9aa28e", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Archive
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(loop.id); setResolveMode("dismiss"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #5a524855", color: "#8a8378", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Dismiss
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => void patch(loop.id, { action: "unresolve" })}
                        style={{ background: "transparent", border: "1px solid #5a524855", color: "#bfb5a8", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        Unresolve
                      </button>
                    )}
                    <button
                      onClick={() => void patch(loop.id, { action: loop.pinned ? "unpin" : "pin" })}
                      style={{ background: "transparent", border: `1px solid ${loop.pinned ? "#fbb86d55" : "#2a2620"}`, color: loop.pinned ? "#fbb86d" : "#8a8378", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer", marginLeft: "auto" }}
                    >
                      {loop.pinned ? "Unpin" : "Pin"}
                    </button>
                    {loop.archived_at && (
                      <button
                        onClick={() => void patch(loop.id, { action: "restore" })}
                        style={{ background: "transparent", border: "1px solid #2a2620", color: "#bfb5a8", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ background: "#0f0d0a", border: `1px solid ${resolveColor(resolveMode)}55`, padding: "12px 14px", marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: resolveColor(resolveMode), letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>
                      {resolveLabel(resolveMode)} this loop
                    </div>
                    <div style={{ fontSize: 11, color: "#8a8378", marginBottom: 10, fontStyle: "italic" }}>
                      {resolveBlurb(resolveMode)}
                    </div>
                    {resolveMode !== "archive" && (
                      <textarea
                        value={resolveNote}
                        onChange={(e) => setResolveNote(e.target.value)}
                        placeholder={
                          resolveMode === "break" ? "what specific commitment ends this loop"
                            : resolveMode === "widen" ? "what new information reframes this loop"
                            : resolveMode === "settle" ? "why this loop is care, not a problem to fix"
                            : "optional note (why dismiss)"
                        }
                        style={{ width: "100%", minHeight: 70, background: "#1a1612", border: "1px solid #2a2620", color: "#e8e0d2", padding: "8px 10px", fontSize: 12, fontFamily: "Georgia, ui-serif, serif", lineHeight: 1.4, resize: "vertical" }}
                      />
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => void submitResolve(loop)}
                        style={{ background: resolveColor(resolveMode), color: "#0f0d0a", border: "none", padding: "6px 14px", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 600, cursor: "pointer" }}
                      >
                        Confirm {resolveLabel(resolveMode)}
                      </button>
                      <button
                        onClick={() => { setResolveOpenId(null); setResolveNote(""); }}
                        style={{ background: "transparent", border: "1px solid #2a2620", color: "#8a8378", padding: "6px 14px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
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
