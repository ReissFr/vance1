"use client";

import { useCallback, useEffect, useState } from "react";

type VoiceType =
  | "parent" | "partner" | "inner_critic" | "social_norm"
  | "professional_norm" | "financial_judge" | "past_self"
  | "future_self" | "mentor" | "abstract_other";

type Status = "active" | "acknowledged" | "integrating" | "retired" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterType = VoiceType | "all";

type Voice = {
  id: string;
  scan_id: string;
  voice_name: string;
  voice_type: VoiceType;
  voice_relation: string | null;
  typical_phrases: string[];
  typical_obligations: string;
  typical_kinds: string[];
  typical_domains: string[];
  airtime_score: number;
  influence_severity: number;
  charge_average: number | null;
  shoulds_attributed: number;
  used_to_linked: number;
  inheritance_mentions: number;
  first_detected_at: string;
  last_detected_at: string;
  detection_span_days: number;
  confidence: number;
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

type TypeRanked = { voice_type: string; rows: number; airtime: number; max_severity: number };

type Stats = {
  total: number;
  active: number;
  acknowledged: number;
  integrating: number;
  retired: number;
  dismissed: number;
  high_severity: number;
  inner_critic_active: number;
  parent_active: number;
  total_airtime: number;
  type_counts_ranked: TypeRanked[];
  dominant_voice: { airtime: number; severity: number; voice_type: string } | null;
  most_severe_voice: { airtime: number; severity: number; voice_type: string } | null;
};

const TYPE_LABEL: Record<VoiceType, string> = {
  parent: "PARENT",
  partner: "PARTNER",
  inner_critic: "INNER CRITIC",
  social_norm: "SOCIAL NORM",
  professional_norm: "PROFESSIONAL NORM",
  financial_judge: "FINANCIAL JUDGE",
  past_self: "PAST SELF",
  future_self: "FUTURE SELF",
  mentor: "MENTOR",
  abstract_other: "DIFFUSE OTHER",
};

const TYPE_COLOR: Record<VoiceType, string> = {
  parent: "#fbb86d",
  partner: "#f4c9d8",
  inner_critic: "#f4577a",
  social_norm: "#bfd4ee",
  professional_norm: "#ffd966",
  financial_judge: "#b8c9b8",
  past_self: "#c9b3f4",
  future_self: "#7affcb",
  mentor: "#e8e0d2",
  abstract_other: "#9aa28e",
};

const SEVERITY_COLOR: Record<number, string> = {
  1: "#9aa28e",
  2: "#b8c9b8",
  3: "#fbb86d",
  4: "#f4a8a8",
  5: "#f4577a",
};

const SEVERITY_LABEL: Record<number, string> = {
  1: "BACKGROUND",
  2: "AUDIBLE",
  3: "SHAPING",
  4: "HEAVY",
  5: "LOUD",
};

const SEVERITY_BLURB: Record<number, string> = {
  1: "a quiet voice in the back",
  2: "audible · you hear it sometimes",
  3: "this voice shapes daily decisions",
  4: "heavy weight · you carry it around",
  5: "loud and chronic · this voice rules",
};

const STATUS_COLOR: Record<Status, string> = {
  active: "#bfb5a8",
  acknowledged: "#bfd4ee",
  integrating: "#fbb86d",
  retired: "#7affcb",
  dismissed: "#9aa28e",
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

export function CabinetConsole() {
  const [rows, setRows] = useState<Voice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("active");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [minSeverity, setMinSeverity] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; updated?: number; latency_ms?: number } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Status>("retired");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("type", typeFilter);
      params.set("min_severity", String(minSeverity));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "100");
      const r = await fetch(`/api/cabinet?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { voices: Voice[]; stats: Stats };
      setRows(j.voices);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, minSeverity, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/cabinet/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; updated?: number; latency_ms?: number };
      setScanResult({ inserted: j.inserted, updated: j.updated, latency_ms: j.latency_ms });
      setComposeOpen(false);
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
      const r = await fetch(`/api/cabinet/${id}`, {
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
          {stats ? `${stats.total} voices in your cabinet · ${stats.high_severity} loud · ${stats.retired} retired` : ""}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: "#7affcb", color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          Build the cabinet
        </button>
      </div>

      {/* Headline stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <Stat label="loud voices" value={stats.high_severity} colour={SEVERITY_COLOR[5] ?? "#f4577a"} big />
          <Stat label="inner critic active" value={stats.inner_critic_active} colour={TYPE_COLOR.inner_critic} big />
          <Stat label="parent voice active" value={stats.parent_active} colour={TYPE_COLOR.parent} />
          <Stat label="total airtime" value={stats.total_airtime} colour="#bfb5a8" />
          <Stat label="retired" value={stats.retired} colour={STATUS_COLOR.retired} />
        </div>
      )}

      {/* Loudest voices in your head */}
      {stats && stats.type_counts_ranked.length > 0 && (
        <div style={{ marginBottom: 18, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            Loudest voices in your head
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.type_counts_ranked.map((t) => {
              const tt = t.voice_type as VoiceType;
              const c = TYPE_COLOR[tt] ?? "#bfb5a8";
              const lbl = TYPE_LABEL[tt] ?? t.voice_type;
              const heavy = t.max_severity >= 4;
              return (
                <div
                  key={t.voice_type}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: `1px solid ${c}`,
                    padding: "5px 10px",
                    background: "#0f0d0a",
                  }}
                >
                  <span style={{ fontSize: 10, color: c, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700 }}>{lbl}</span>
                  <span style={{ fontSize: 11, color: "#bfb5a8" }}>airtime {t.airtime} · {t.rows} {t.rows === 1 ? "row" : "rows"}</span>
                  {heavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[t.max_severity] ?? "#bfb5a8", letterSpacing: 1, textTransform: "uppercase" }}>{SEVERITY_LABEL[t.max_severity] ?? ""}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {(["active", "acknowledged", "integrating", "retired", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
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

      {/* Type filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Voice type:</span>
        {(["all", "parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "past_self", "future_self", "mentor", "abstract_other"] as const).map((t) => {
          const active = typeFilter === t;
          const c = t === "all" ? "#bfb5a8" : TYPE_COLOR[t as VoiceType];
          const lbl = t === "all" ? "all" : TYPE_LABEL[t as VoiceType].toLowerCase();
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
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
              {lbl}
            </button>
          );
        })}
      </div>

      {/* Min severity + min confidence */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min severity:</span>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = minSeverity === n;
            const c = SEVERITY_COLOR[n] ?? "#bfb5a8";
            return (
              <button
                key={n}
                onClick={() => setMinSeverity(n)}
                style={{
                  background: active ? c : "transparent",
                  color: active ? "#1c1815" : c,
                  border: `1px solid ${c}`,
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
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min confidence:</span>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = minConfidence === n;
            return (
              <button
                key={n}
                onClick={() => setMinConfidence(n)}
                style={{
                  background: active ? "#7affcb" : "transparent",
                  color: active ? "#1c1815" : "#7affcb",
                  border: `1px solid #7affcb`,
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
      </div>

      {error && <div style={{ color: "#f4a8a8", fontSize: 13, marginBottom: 12 }}>error: {error}</div>}
      {scanResult && (
        <div style={{ background: "#171411", border: "1px solid #7affcb", padding: 12, marginBottom: 14, fontSize: 12, color: "#e8e0d2" }}>
          cabinet built · {scanResult.inserted} new voices · {scanResult.updated ?? 0} refreshed · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "your cabinet is empty — run a should ledger scan first, then build the cabinet to see whose voices are running you" : "no voices match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((c) => {
            const sevTint = SEVERITY_COLOR[c.influence_severity] ?? "#bfb5a8";
            const tTint = TYPE_COLOR[c.voice_type];
            const statusColour = STATUS_COLOR[c.status];
            const isRetired = c.status === "retired";
            const isAcked = c.status === "acknowledged";
            const tint = isRetired ? STATUS_COLOR.retired : isAcked ? STATUS_COLOR.acknowledged : sevTint;
            const span = c.detection_span_days >= 7
              ? `${Math.round(c.detection_span_days / 7)}w span`
              : `${c.detection_span_days}d span`;
            return (
              <div
                key={c.id}
                style={{
                  border: `1px solid ${c.pinned ? tint : "#2a2620"}`,
                  borderLeft: `3px solid ${tint}`,
                  padding: 16,
                  background: c.archived_at ? "#0f0d0a" : "#171411",
                  opacity: c.archived_at ? 0.6 : 1,
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: tTint, letterSpacing: 1.6, textTransform: "uppercase" }}>{TYPE_LABEL[c.voice_type]}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sevTint, letterSpacing: 1.6, textTransform: "uppercase", border: `1px solid ${sevTint}`, padding: "1px 5px" }}>{SEVERITY_LABEL[c.influence_severity] ?? ""}</span>
                    <span style={{ fontSize: 11, color: "#5a544c", fontStyle: "italic" }}>{SEVERITY_BLURB[c.influence_severity] ?? ""}</span>
                    {dotMeter(c.confidence, "#bfb5a8")}
                    {c.status !== "active" && (
                      <span style={{ fontSize: 9, color: statusColour, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${statusColour}`, padding: "1px 5px" }}>
                        {c.status}
                      </span>
                    )}
                    {c.pinned && (
                      <span style={{ fontSize: 9, color: tint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tint}`, padding: "1px 5px" }}>pinned</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#5a544c" }}>airtime {c.airtime_score} · {span}{c.charge_average != null ? ` · charge avg ${c.charge_average}` : ""}</div>
                </div>

                {/* Voice name */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${tTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    The voice
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 26, color: "#e8e0d2", lineHeight: 1.3, fontStyle: "italic" }}>
                    {c.voice_name}
                  </div>
                  {c.voice_relation && (
                    <div style={{ marginTop: 8, fontSize: 13, color: "#8a8378", fontStyle: "italic" }}>
                      {c.voice_relation}
                    </div>
                  )}
                </div>

                {/* Typical obligations */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${tTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    What this voice tends to demand
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.5 }}>
                    {c.typical_obligations}
                  </div>
                  {(c.typical_kinds.length > 0 || c.typical_domains.length > 0) && (
                    <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {c.typical_kinds.length > 0 && (
                        <div style={{ fontSize: 11, color: "#8a8378" }}>
                          surfaces around: <span style={{ color: tTint, fontWeight: 600 }}>{c.typical_kinds.join(", ")}</span>
                        </div>
                      )}
                      {c.typical_domains.length > 0 && (
                        <div style={{ fontSize: 11, color: "#8a8378" }}>
                          domains: <span style={{ color: "#bfb5a8" }}>{c.typical_domains.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Typical phrases */}
                {c.typical_phrases.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Verbatim shoulds attributed to this voice ({c.shoulds_attributed})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {c.typical_phrases.slice(0, 6).map((p, i) => (
                        <div key={i} style={{ fontSize: 13, color: "#bfb5a8", padding: "6px 10px", background: "#0f0d0a", borderLeft: `1px solid ${tTint}55`, lineHeight: 1.45, fontStyle: "italic" }}>
                          &ldquo;{p}&rdquo;
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Status note for resolved rows */}
                {c.status === "retired" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.retired}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.retired, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>Why this voice no longer rules you</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {c.status === "integrating" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.integrating}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.integrating, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>Wisdom kept · pressure left behind</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {c.status === "acknowledged" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.acknowledged}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.acknowledged, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>You see this voice</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 16, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {c.status === "dismissed" && c.status_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic", marginBottom: 8 }}>
                    your note: {c.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {resolveOpenId === c.id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2620" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["retired", "integrating", "acknowledged", "dismissed"] as const).map((s) => {
                        const active = resolveStatus === s;
                        const col = STATUS_COLOR[s];
                        return (
                          <button
                            key={s}
                            onClick={() => setResolveStatus(s)}
                            style={{
                              background: active ? col : "transparent",
                              color: active ? "#1c1815" : col,
                              border: `1px solid ${col}`,
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
                      placeholder={
                        resolveStatus === "retired"
                          ? `Why are you taking authority back from this voice? "These are my mum's standards, not mine. I do not give them ruling weight any more." Required for 'retired'.`
                          : resolveStatus === "integrating"
                          ? `What wisdom are you keeping? What are you leaving behind? "I keep the value about presence; I leave the guilt-as-pressure delivery." Required for 'integrating'.`
                          : resolveStatus === "acknowledged"
                          ? `What do you want to record about hearing this voice? (optional)`
                          : "optional note..."
                      }
                      rows={resolveStatus === "retired" || resolveStatus === "integrating" ? 4 : 3}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: resolveStatus === "retired" ? "Georgia, serif" : "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          if (resolveStatus === "retired" && resolveNote.trim().length === 0) {
                            setError("name why this voice no longer rules you before retiring it");
                            return;
                          }
                          if (resolveStatus === "integrating" && resolveNote.trim().length === 0) {
                            setError("name the wisdom you keep and the pressure you leave before integrating");
                            return;
                          }
                          const body: Record<string, unknown> = { status: resolveStatus };
                          if (resolveNote.trim().length > 0) body.status_note = resolveNote;
                          await patch(c.id, body);
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
                    {c.status === "active" && (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("retired"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: STATUS_COLOR.retired, color: "#1c1815", border: `1px solid ${STATUS_COLOR.retired}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          retire it
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("integrating"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: STATUS_COLOR.integrating, color: "#1c1815", border: `1px solid ${STATUS_COLOR.integrating}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          integrate it
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("acknowledged"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: "transparent", color: STATUS_COLOR.acknowledged, border: `1px solid ${STATUS_COLOR.acknowledged}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          acknowledge
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("dismissed"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: "transparent", color: STATUS_COLOR.dismissed, border: `1px solid ${STATUS_COLOR.dismissed}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          dismiss
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => patch(c.id, { pin: !c.pinned })}
                      style={{ background: "transparent", color: c.pinned ? tint : "#8a8378", border: `1px solid ${c.pinned ? tint : "#2a2620"}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                    >
                      {c.pinned ? "unpin" : "pin"}
                    </button>
                    {c.archived_at ? (
                      <button
                        onClick={() => patch(c.id, { restore: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        unarchive
                      </button>
                    ) : (
                      <button
                        onClick={() => patch(c.id, { archive: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        archive
                      </button>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#5a544c" }}>updated {relTime(c.updated_at)}</span>
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
            style={{ background: "#171411", border: "1px solid #7affcb", padding: 24, width: "min(440px, 92vw)" }}
          >
            <div style={{ fontSize: 13, color: "#7affcb", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 12 }}>
              Build the cabinet
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Reads your should ledger and groups every &ldquo;I should&rdquo; you have typed by whose voice put it there. Surfaces the discrete voices in your head as one row each. Run a should ledger scan first if you have not. Re-scans refresh existing voices and add any new ones detected.
            </div>
            <div style={{ fontSize: 11, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Once a voice is in the cabinet you have three moves: <strong style={{ color: "#7affcb" }}>retire</strong> a voice that no longer rules you (name why), <strong style={{ color: "#fbb86d" }}>integrate</strong> a voice (keep its wisdom, name what), or simply <strong style={{ color: "#bfd4ee" }}>acknowledge</strong> that the voice exists.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                onClick={runScan}
                disabled={scanning}
                style={{
                  background: scanning ? "#3a342c" : "#7affcb",
                  color: scanning ? "#8a8378" : "#1c1815",
                  border: "none",
                  padding: "9px 16px",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  cursor: scanning ? "not-allowed" : "pointer",
                }}
              >
                {scanning ? "building..." : "Build cabinet"}
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
