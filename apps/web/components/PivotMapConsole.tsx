"use client";

import { useCallback, useEffect, useState } from "react";

type Sample = { date: string; snippet: string };

type PivotKind = "verbal" | "thematic" | "stance_reversal" | "abandonment" | "recommitment";
type Domain =
  | "work" | "relationships" | "health" | "identity"
  | "finance" | "creative" | "learning" | "daily" | "other";
type Quality = "stuck" | "performed" | "reverted" | "quiet" | "too_recent";
type Status = "pending" | "acknowledged" | "contested" | "superseded" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterQuality = Quality | "all";
type FilterDomain = Domain | "all";

type Pivot = {
  id: string;
  scan_id: string;
  pivot_text: string;
  pivot_kind: PivotKind;
  domain: Domain;
  pivot_date: string;
  pivot_message_id: string | null;
  pivot_conversation_id: string | null;
  from_state: string;
  to_state: string;
  from_aliases: string[];
  to_aliases: string[];
  days_since_pivot: number;
  follow_through_count: number;
  follow_through_days: number;
  back_slide_count: number;
  back_slide_days: number;
  follow_through_samples: Sample[];
  back_slide_samples: Sample[];
  pivot_quality: Quality;
  confidence: number;
  status: Status;
  status_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  pending: number;
  acknowledged: number;
  contested: number;
  superseded: number;
  dismissed: number;
  quality: Record<Quality, number>;
  domain_counts: Record<Domain, number>;
};

const PIVOT_KIND_LABEL: Record<PivotKind, string> = {
  verbal: "VERBAL PIVOT",
  thematic: "THEMATIC PIVOT",
  stance_reversal: "STANCE REVERSAL",
  abandonment: "ABANDONMENT",
  recommitment: "RECOMMITMENT",
};

const QUALITY_LABEL: Record<Quality, string> = {
  stuck: "STUCK",
  performed: "PERFORMED",
  reverted: "REVERTED",
  quiet: "QUIET",
  too_recent: "TOO RECENT",
};

const QUALITY_COLOR: Record<Quality, string> = {
  stuck: "#7affcb",
  performed: "#bfb5a8",
  reverted: "#f4a8a8",
  quiet: "#9aa28e",
  too_recent: "#c9b3f4",
};

const QUALITY_BLURB: Record<Quality, string> = {
  stuck: "you actually turned",
  performed: "you said it but neither side moved",
  reverted: "you slid back to where you were",
  quiet: "small signals on both sides",
  too_recent: "give it time",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  acknowledged: "#7affcb",
  contested: "#fbb86d",
  superseded: "#c9b3f4",
  dismissed: "#9aa28e",
};

const DOMAIN_COLOR: Record<Domain, string> = {
  work: "#bfd4ee",
  relationships: "#f4c9d8",
  health: "#7affcb",
  identity: "#c9b3f4",
  finance: "#ffd966",
  creative: "#fbb86d",
  learning: "#b8c9b8",
  daily: "#e8e0d2",
  other: "#9aa28e",
};

const KIND_COLOR: Record<PivotKind, string> = {
  verbal: "#fbb86d",
  thematic: "#bfd4ee",
  stance_reversal: "#f4c9d8",
  abandonment: "#9aa28e",
  recommitment: "#7affcb",
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
        <span key={i} style={{ width: 7, height: 7, borderRadius: 7, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function PivotMapConsole() {
  const [rows, setRows] = useState<Pivot[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [qualityFilter, setQualityFilter] = useState<FilterQuality>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(120);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Status>("acknowledged");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("quality", qualityFilter);
      params.set("domain", domainFilter);
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "100");
      const r = await fetch(`/api/pivot-map?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { pivots: Pivot[]; stats: Stats };
      setRows(j.pivots);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, qualityFilter, domainFilter, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/pivot-map/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: composeWindow }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; latency_ms?: number; signals?: Record<string, number> };
      setScanResult({ inserted: j.inserted, latency_ms: j.latency_ms, signals: j.signals });
      setComposeOpen(false);
      setStatusFilter("pending");
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
      const r = await fetch(`/api/pivot-map/${id}`, {
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

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} pivots · ${stats.quality.stuck} stuck · ${stats.quality.reverted} reverted · ${stats.quality.performed} performed` : ""}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: "#fbb86d", color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          Scan for pivots
        </button>
      </div>

      {/* Quality stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <Stat label="stuck" value={stats.quality.stuck} colour={QUALITY_COLOR.stuck} big />
          <Stat label="reverted" value={stats.quality.reverted} colour={QUALITY_COLOR.reverted} big />
          <Stat label="performed" value={stats.quality.performed} colour={QUALITY_COLOR.performed} />
          <Stat label="quiet" value={stats.quality.quiet} colour={QUALITY_COLOR.quiet} />
          <Stat label="too recent" value={stats.quality.too_recent} colour={QUALITY_COLOR.too_recent} />
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {(["pending", "acknowledged", "contested", "superseded", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                background: active ? "#3a342c" : "transparent",
                color: active ? "#e8e0d2" : "#8a8378",
                border: `1px solid ${active ? "#5a544c" : "#2a2620"}`,
                padding: "5px 12px",
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Quality filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Quality:</span>
        {(["all", "stuck", "performed", "reverted", "quiet", "too_recent"] as const).map((q) => {
          const active = qualityFilter === q;
          const c = q === "all" ? "#bfb5a8" : QUALITY_COLOR[q as Quality];
          return (
            <button
              key={q}
              onClick={() => setQualityFilter(q)}
              style={{
                background: active ? c : "transparent",
                color: active ? "#1c1815" : c,
                border: `1px solid ${c}`,
                padding: "3px 10px",
                fontSize: 10,
                letterSpacing: 1,
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: active ? 700 : 500,
              }}
            >
              {q === "too_recent" ? "too recent" : q}
            </button>
          );
        })}
      </div>

      {/* Domain filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Domain:</span>
        {(["all", "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other"] as const).map((d) => {
          const active = domainFilter === d;
          const c = d === "all" ? "#bfb5a8" : DOMAIN_COLOR[d as Domain];
          const count = stats && d !== "all" ? stats.domain_counts[d as Domain] : null;
          return (
            <button
              key={d}
              onClick={() => setDomainFilter(d)}
              style={{
                background: active ? c : "transparent",
                color: active ? "#1c1815" : c,
                border: `1px solid ${c}`,
                padding: "3px 10px",
                fontSize: 10,
                letterSpacing: 0.4,
                cursor: "pointer",
                fontWeight: active ? 700 : 500,
              }}
            >
              {d}{count != null ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Min confidence */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min confidence:</span>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = minConfidence === n;
          return (
            <button
              key={n}
              onClick={() => setMinConfidence(n)}
              style={{
                background: active ? "#fbb86d" : "transparent",
                color: active ? "#1c1815" : "#fbb86d",
                border: `1px solid #fbb86d`,
                padding: "3px 8px",
                fontSize: 10,
                letterSpacing: 0.4,
                cursor: "pointer",
                fontWeight: active ? 700 : 500,
              }}
            >
              ≥ {n}
            </button>
          );
        })}
      </div>

      {error && <div style={{ color: "#f4a8a8", fontSize: 13, marginBottom: 12 }}>error: {error}</div>}
      {scanResult && (
        <div style={{ background: "#171411", border: "1px solid #fbb86d", padding: 12, marginBottom: 14, fontSize: 12, color: "#e8e0d2" }}>
          scan complete · {scanResult.inserted} new pivots · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.pivot_candidates != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.pivot_candidates} candidate moments, {scanResult.signals.pivots_extracted ?? 0} valid</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "no scan yet — run one to find the moments you turned" : "no pivots match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((p) => {
            const qTint = QUALITY_COLOR[p.pivot_quality];
            const kTint = KIND_COLOR[p.pivot_kind];
            const dTint = DOMAIN_COLOR[p.domain];
            const statusColour = STATUS_COLOR[p.status];
            return (
              <div
                key={p.id}
                style={{
                  border: `1px solid ${p.pinned ? qTint : "#2a2620"}`,
                  borderLeft: `3px solid ${qTint}`,
                  padding: 16,
                  background: p.archived_at ? "#0f0d0a" : "#171411",
                  opacity: p.archived_at ? 0.6 : 1,
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: kTint, letterSpacing: 1.6, textTransform: "uppercase" }}>{PIVOT_KIND_LABEL[p.pivot_kind]}</span>
                    <span style={{ fontSize: 9, color: dTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${dTint}`, padding: "1px 5px" }}>{p.domain}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: qTint, letterSpacing: 1.6, textTransform: "uppercase" }}>· {QUALITY_LABEL[p.pivot_quality]}</span>
                    <span style={{ fontSize: 11, color: "#5a544c", fontStyle: "italic" }}>{QUALITY_BLURB[p.pivot_quality]}</span>
                    {dotMeter(p.confidence, "#bfb5a8")}
                    {p.status !== "pending" && (
                      <span style={{ fontSize: 9, color: statusColour, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${statusColour}`, padding: "1px 5px" }}>
                        {p.status}
                      </span>
                    )}
                    {p.pinned && (
                      <span style={{ fontSize: 9, color: qTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${qTint}`, padding: "1px 5px" }}>pinned</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#5a544c" }}>{p.pivot_date} · {p.days_since_pivot}d ago</div>
                </div>

                {/* The turn — from → to */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", minWidth: 36, paddingTop: 2 }}>from</span>
                    <span style={{ fontFamily: "Georgia, serif", fontSize: 16, color: "#bfb5a8", textDecoration: "line-through", textDecorationColor: "#5a544c", lineHeight: 1.45 }}>
                      {p.from_state}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 10, color: qTint, letterSpacing: 1.2, textTransform: "uppercase", minWidth: 36, paddingTop: 2, fontWeight: 700 }}>to</span>
                    <span style={{ fontFamily: "Georgia, serif", fontSize: 18, color: qTint, lineHeight: 1.45, fontWeight: 500 }}>
                      {p.to_state}
                    </span>
                  </div>
                </div>

                {/* Quality verdict — follow-through vs back-slide side-by-side */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  <div style={{ background: "#0f0d0a", borderLeft: `2px solid ${QUALITY_COLOR.stuck}`, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>Follow through</div>
                    <div style={{ fontSize: 22, color: QUALITY_COLOR.stuck, fontWeight: 700 }}>{p.follow_through_count}</div>
                    <div style={{ fontSize: 10, color: "#5a544c" }}>mentions of new direction · across {p.follow_through_days}d</div>
                  </div>
                  <div style={{ background: "#0f0d0a", borderLeft: `2px solid ${QUALITY_COLOR.reverted}`, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>Back slide</div>
                    <div style={{ fontSize: 22, color: QUALITY_COLOR.reverted, fontWeight: 700 }}>{p.back_slide_count}</div>
                    <div style={{ fontSize: 10, color: "#5a544c" }}>mentions of old direction · across {p.back_slide_days}d</div>
                  </div>
                </div>

                {/* The pivot quote */}
                <div style={{ background: "#1c1815", borderLeft: `2px solid ${kTint}`, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>The moment you turned ({p.pivot_date})</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 15, fontStyle: "italic", color: "#e8e0d2", lineHeight: 1.5 }}>
                    &ldquo;{p.pivot_text}&rdquo;
                  </div>
                </div>

                {/* Follow-through samples */}
                {p.follow_through_samples.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: QUALITY_COLOR.stuck, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
                      Following through ({p.follow_through_count} times — sample of {p.follow_through_samples.length}):
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {p.follow_through_samples.map((m, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#bfb5a8", padding: "6px 10px", background: "#0f0d0a", borderLeft: `1px solid ${QUALITY_COLOR.stuck}33`, lineHeight: 1.45 }}>
                          <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", marginRight: 8 }}>{m.date}</span>
                          <span style={{ fontStyle: "italic" }}>{m.snippet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Back-slide samples */}
                {p.back_slide_samples.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: QUALITY_COLOR.reverted, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
                      Sliding back ({p.back_slide_count} times — sample of {p.back_slide_samples.length}):
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {p.back_slide_samples.map((m, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#bfb5a8", padding: "6px 10px", background: "#0f0d0a", borderLeft: `1px solid ${QUALITY_COLOR.reverted}33`, lineHeight: 1.45 }}>
                          <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", marginRight: 8 }}>{m.date}</span>
                          <span style={{ fontStyle: "italic" }}>{m.snippet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Aliases */}
                {(p.from_aliases.length > 0 || p.to_aliases.length > 0) && (
                  <div style={{ fontSize: 10, color: "#5a544c", marginBottom: 12, lineHeight: 1.5 }}>
                    matched old: <span style={{ fontFamily: "ui-monospace, monospace", color: "#8a8378" }}>{p.from_aliases.join(" / ")}</span>
                    {" · "}
                    matched new: <span style={{ fontFamily: "ui-monospace, monospace", color: qTint }}>{p.to_aliases.join(" / ")}</span>
                  </div>
                )}

                {/* Status note */}
                {p.status_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic", marginBottom: 8 }}>
                    your note: {p.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {resolveOpenId === p.id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2620" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["acknowledged", "contested", "superseded", "dismissed"] as const).map((s) => {
                        const active = resolveStatus === s;
                        const c = STATUS_COLOR[s];
                        return (
                          <button
                            key={s}
                            onClick={() => setResolveStatus(s)}
                            style={{
                              background: active ? c : "transparent",
                              color: active ? "#1c1815" : c,
                              border: `1px solid ${c}`,
                              padding: "4px 11px",
                              fontSize: 10,
                              letterSpacing: 1.2,
                              textTransform: "uppercase",
                              cursor: "pointer",
                              fontWeight: active ? 700 : 500,
                            }}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="optional note — what's actually going on..."
                      rows={2}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          const body: Record<string, unknown> = { status: resolveStatus };
                          if (resolveNote.trim().length > 0) body.status_note = resolveNote;
                          await patch(p.id, body);
                          setResolveOpenId(null);
                          setResolveNote("");
                        }}
                        style={{ background: STATUS_COLOR[resolveStatus], color: "#1c1815", border: "none", padding: "5px 12px", fontSize: 11, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
                      >
                        save as {resolveStatus}
                      </button>
                      <button
                        onClick={() => { setResolveOpenId(null); setResolveNote(""); }}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, cursor: "pointer" }}
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 10, borderTop: "1px solid #2a2620", flexWrap: "wrap" }}>
                    {p.status === "pending" && (
                      <>
                        {(["acknowledged", "contested", "superseded", "dismissed"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => { setResolveOpenId(p.id); setResolveStatus(s); setResolveNote(p.status_note ?? ""); }}
                            style={{ background: "transparent", color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                          >
                            {s}
                          </button>
                        ))}
                      </>
                    )}
                    <button
                      onClick={() => patch(p.id, { pin: !p.pinned })}
                      style={{ background: "transparent", color: p.pinned ? qTint : "#8a8378", border: `1px solid ${p.pinned ? qTint : "#2a2620"}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                    >
                      {p.pinned ? "unpin" : "pin"}
                    </button>
                    {p.archived_at ? (
                      <button
                        onClick={() => patch(p.id, { restore: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        restore
                      </button>
                    ) : (
                      <button
                        onClick={() => patch(p.id, { archive: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        archive
                      </button>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#5a544c" }}>{relTime(p.created_at)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (
        <div
          onClick={() => setComposeOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#171411", border: "1px solid #fbb86d", padding: 24, width: "min(440px, 92vw)" }}
          >
            <div style={{ fontSize: 13, color: "#fbb86d", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 12 }}>
              Scan for pivots
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Mines your messages in the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong> for inflection moments — verbal pivots, stance reversals, abandonments, recommitments — then counts mentions of the OLD and NEW direction since each pivot to tell you whether the pivot stuck or whether you slid back.
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>Window</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[30, 60, 90, 120, 180, 270, 365].map((days) => (
                  <button
                    key={days}
                    onClick={() => setComposeWindow(days)}
                    style={{
                      background: composeWindow === days ? "#fbb86d" : "transparent",
                      color: composeWindow === days ? "#1c1815" : "#bfb5a8",
                      border: `1px solid ${composeWindow === days ? "#fbb86d" : "#2a2620"}`,
                      padding: "5px 11px",
                      fontSize: 11,
                      letterSpacing: 0.6,
                      cursor: "pointer",
                      fontWeight: composeWindow === days ? 700 : 500,
                    }}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                onClick={runScan}
                disabled={scanning}
                style={{
                  background: scanning ? "#3a342c" : "#fbb86d",
                  color: scanning ? "#8a8378" : "#1c1815",
                  border: "none",
                  padding: "9px 16px",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  cursor: scanning ? "not-allowed" : "pointer",
                }}
              >
                {scanning ? "scanning..." : "Run scan"}
              </button>
              <button
                onClick={() => setComposeOpen(false)}
                style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "9px 16px", fontSize: 12, cursor: "pointer" }}
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, colour, big = false }: { label: string; value: number; colour: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 20, color: colour, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
