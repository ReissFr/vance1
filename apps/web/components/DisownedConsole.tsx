"use client";

import { useCallback, useEffect, useState } from "react";

type RecurrenceSample = { date: string; snippet: string };

type DisownedKind = "distancing_pronoun" | "external_attribution" | "abstract_body" | "generic_universal" | "passive_self";
type TargetKind = "emotion" | "bodily_state" | "mental_state" | "relationship_dynamic" | "behaviour" | "need" | "desire" | "judgment";
type Domain =
  | "work" | "relationships" | "health" | "identity"
  | "finance" | "creative" | "learning" | "daily" | "other";
type Status = "pending" | "reclaimed" | "kept" | "noted" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterKind = DisownedKind | "all";
type FilterTarget = TargetKind | "all";
type FilterDomain = Domain | "all";

type Disowned = {
  id: string;
  scan_id: string;
  disowned_text: string;
  disowned_kind: DisownedKind;
  what_was_disowned: string | null;
  what_was_disowned_kind: TargetKind | null;
  self_voice: string | null;
  domain: Domain;
  spoken_date: string;
  spoken_message_id: string | null;
  spoken_conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_with_target: number;
  recurrence_samples: RecurrenceSample[];
  pattern_severity: number;
  confidence: number;
  status: Status;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type VoiceCount = { voice: string; rows: number; chronic_rows: number; total_recurrence: number };
type TargetCount = { target: string; rows: number; chronic_rows: number; total_recurrence: number };

type Stats = {
  total: number;
  pending: number;
  reclaimed: number;
  kept: number;
  noted: number;
  dismissed: number;
  reflex_disowned: number;
  external_attribution: number;
  disowned_emotions: number;
  disowned_bodily: number;
  kind_counts: Record<DisownedKind, number>;
  target_counts: TargetCount[];
  voice_counts: VoiceCount[];
  domain_counts: Record<Domain, number>;
};

const KIND_LABEL: Record<DisownedKind, string> = {
  distancing_pronoun: "DISTANCING PRONOUN",
  external_attribution: "EXTERNAL ATTRIBUTION",
  abstract_body: "ABSTRACT BODY",
  generic_universal: "GENERIC UNIVERSAL",
  passive_self: "AGENTLESS PASSIVE",
};

const KIND_COLOR: Record<DisownedKind, string> = {
  distancing_pronoun: "#bfd4ee",
  external_attribution: "#f4577a",
  abstract_body: "#f4a8a8",
  generic_universal: "#fbb86d",
  passive_self: "#c9b3f4",
};

const TARGET_LABEL: Record<TargetKind, string> = {
  emotion: "AN EMOTION",
  bodily_state: "A BODILY STATE",
  mental_state: "A MENTAL STATE",
  relationship_dynamic: "A RELATIONSHIP DYNAMIC",
  behaviour: "A BEHAVIOUR",
  need: "A NEED",
  desire: "A DESIRE",
  judgment: "A JUDGMENT",
};

const TARGET_COLOR: Record<TargetKind, string> = {
  emotion: "#f4c9d8",
  bodily_state: "#f4a8a8",
  mental_state: "#bfd4ee",
  relationship_dynamic: "#c9b3f4",
  behaviour: "#fbb86d",
  need: "#f4577a",
  desire: "#7affcb",
  judgment: "#e8e0d2",
};

const SEVERITY_COLOR: Record<number, string> = {
  1: "#9aa28e",
  2: "#b8c9b8",
  3: "#fbb86d",
  4: "#f4a8a8",
  5: "#f4577a",
};

const SEVERITY_LABEL: Record<number, string> = {
  1: "ISOLATED",
  2: "EMERGING",
  3: "HABITUAL",
  4: "ENTRENCHED",
  5: "REFLEX",
};

const SEVERITY_BLURB: Record<number, string> = {
  1: "one moment · the spectator spoke once",
  2: "starting to repeat · the narrator is forming a habit",
  3: "it's habitual now · the spectator narrates this from outside",
  4: "this is entrenched · you describe yourself as someone else",
  5: "this is reflex · the spectator IS the voice now",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  reclaimed: "#7affcb",
  kept: "#fbb86d",
  noted: "#bfd4ee",
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

export function DisownedConsole() {
  const [rows, setRows] = useState<Disowned[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [targetFilter, setTargetFilter] = useState<FilterTarget>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minSeverity, setMinSeverity] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(120);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Status>("reclaimed");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("kind", kindFilter);
      params.set("target", targetFilter);
      params.set("domain", domainFilter);
      params.set("min_severity", String(minSeverity));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "100");
      const r = await fetch(`/api/disowned?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { disownerships: Disowned[]; stats: Stats };
      setRows(j.disownerships);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, targetFilter, domainFilter, minSeverity, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/disowned/scan`, {
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
      const r = await fetch(`/api/disowned/${id}`, {
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
          {stats ? `${stats.total} disownerships · ${stats.reflex_disowned} reflex · ${stats.external_attribution} external attribution` : ""}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: "#7affcb", color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          Mine the register
        </button>
      </div>

      {/* Headline stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <Stat label="reflex disowning" value={stats.reflex_disowned} colour={SEVERITY_COLOR[5] ?? "#f4577a"} big />
          <Stat label="external attribution" value={stats.external_attribution} colour={KIND_COLOR.external_attribution} big />
          <Stat label="emotions disowned" value={stats.disowned_emotions} colour={TARGET_COLOR.emotion} />
          <Stat label="bodily states disowned" value={stats.disowned_bodily} colour={TARGET_COLOR.bodily_state} />
          <Stat label="reclaimed as yours" value={stats.reclaimed} colour={STATUS_COLOR.reclaimed} />
        </div>
      )}

      {/* Top spectator voices panel — who narrates you from outside */}
      {stats && stats.voice_counts.length > 0 && (
        <div style={{ marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            The voices that narrate you from outside
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.voice_counts.map((v) => {
              const chronicHeavy = v.chronic_rows > 0;
              const c = chronicHeavy ? SEVERITY_COLOR[5] ?? "#f4577a" : "#bfb5a8";
              return (
                <div
                  key={v.voice}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: `1px solid ${c}`,
                    padding: "5px 10px",
                    background: "#0f0d0a",
                  }}
                >
                  <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", color: "#e8e0d2", fontSize: 13 }}>{v.voice}</span>
                  <span style={{ fontSize: 11, color: "#bfb5a8" }}>{v.rows} {v.rows === 1 ? "row" : "rows"} · ×{v.total_recurrence}</span>
                  {chronicHeavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 1, textTransform: "uppercase" }}>{v.chronic_rows} chronic</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* What gets disowned — emotions, bodily states, behaviours */}
      {stats && stats.target_counts.length > 0 && (
        <div style={{ marginBottom: 18, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            What you keep externalising
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.target_counts.map((t) => {
              const tk = t.target as TargetKind;
              const c = TARGET_COLOR[tk] ?? "#bfb5a8";
              const lbl = TARGET_LABEL[tk] ?? t.target;
              const chronicHeavy = t.chronic_rows > 0;
              return (
                <div
                  key={t.target}
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
                  <span style={{ fontSize: 11, color: "#bfb5a8" }}>{t.rows} {t.rows === 1 ? "row" : "rows"} · ×{t.total_recurrence}</span>
                  {chronicHeavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 1, textTransform: "uppercase" }}>{t.chronic_rows} chronic</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {(["pending", "reclaimed", "kept", "noted", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
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

      {/* Kind filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Kind:</span>
        {(["all", "distancing_pronoun", "external_attribution", "abstract_body", "generic_universal", "passive_self"] as const).map((k) => {
          const active = kindFilter === k;
          const c = k === "all" ? "#bfb5a8" : KIND_COLOR[k as DisownedKind];
          const count = stats && k !== "all" ? stats.kind_counts[k as DisownedKind] : null;
          const lbl = k === "all" ? "all" : KIND_LABEL[k as DisownedKind].toLowerCase();
          return (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
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
              {lbl}{count != null ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Target filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Disowned:</span>
        {(["all", "emotion", "bodily_state", "mental_state", "relationship_dynamic", "behaviour", "need", "desire", "judgment"] as const).map((t) => {
          const active = targetFilter === t;
          const c = t === "all" ? "#bfb5a8" : TARGET_COLOR[t as TargetKind];
          const lbl = t === "all" ? "all" : TARGET_LABEL[t as TargetKind].toLowerCase();
          return (
            <button
              key={t}
              onClick={() => setTargetFilter(t)}
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
          scan complete · {scanResult.inserted} new disownerships surfaced · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.disowned_candidates != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.disowned_candidates} candidate moments, {scanResult.signals.disownerships_extracted ?? 0} valid</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "no scan yet — run one to surface the moments you described your own life as if it were someone else's" : "no disownerships match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((c) => {
            const sevTint = SEVERITY_COLOR[c.pattern_severity] ?? "#bfb5a8";
            const kTint = KIND_COLOR[c.disowned_kind];
            const dTint = DOMAIN_COLOR[c.domain];
            const tTint = c.what_was_disowned_kind ? TARGET_COLOR[c.what_was_disowned_kind] : "#bfb5a8";
            const statusColour = STATUS_COLOR[c.status];
            const isReclaimed = c.status === "reclaimed";
            const tint = isReclaimed ? STATUS_COLOR.reclaimed : sevTint;
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
                    <span style={{ fontSize: 10, fontWeight: 700, color: kTint, letterSpacing: 1.6, textTransform: "uppercase" }}>{KIND_LABEL[c.disowned_kind]}</span>
                    {c.what_was_disowned_kind && (
                      <span style={{ fontSize: 9, color: tTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tTint}`, padding: "1px 5px" }}>{TARGET_LABEL[c.what_was_disowned_kind]}</span>
                    )}
                    <span style={{ fontSize: 9, color: dTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${dTint}`, padding: "1px 5px" }}>{c.domain}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sevTint, letterSpacing: 1.6, textTransform: "uppercase" }}>· {SEVERITY_LABEL[c.pattern_severity] ?? ""}</span>
                    <span style={{ fontSize: 11, color: "#5a544c", fontStyle: "italic" }}>{SEVERITY_BLURB[c.pattern_severity] ?? ""}</span>
                    {dotMeter(c.confidence, "#bfb5a8")}
                    {c.status !== "pending" && (
                      <span style={{ fontSize: 9, color: statusColour, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${statusColour}`, padding: "1px 5px" }}>
                        {c.status}
                      </span>
                    )}
                    {c.pinned && (
                      <span style={{ fontSize: 9, color: tint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tint}`, padding: "1px 5px" }}>pinned</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#5a544c" }}>spoken {c.spoken_date}</div>
                </div>

                {/* The verbatim disowned phrase */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${kTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    How you described it
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 24, color: "#e8e0d2", lineHeight: 1.3, fontStyle: "italic" }}>
                    &ldquo;{c.disowned_text}&rdquo;
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    {c.recurrence_count > 1 ? (
                      <div style={{ fontSize: 11, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 0.4 }}>
                        you described yourself this way {c.recurrence_count} times · across {c.recurrence_days} day{c.recurrence_days === 1 ? "" : "s"}{c.recurrence_with_target > 1 ? ` · ${c.recurrence_with_target} of those alongside genuine first-person content` : ""}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#5a544c", letterSpacing: 0.4 }}>first time this disownership shape has surfaced in the window</div>
                    )}
                  </div>
                </div>

                {/* The I-form rewrite — what they actually meant */}
                {c.what_was_disowned ? (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${tTint}` }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      What you were actually saying
                    </div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.what_was_disowned}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${SEVERITY_COLOR[1] ?? "#9aa28e"}` }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      No I-form reading captured
                    </div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 14, color: "#8a8378", lineHeight: 1.5, fontStyle: "italic" }}>
                      could be stylistic — what would this sound like in I-form, active voice?
                    </div>
                  </div>
                )}

                {/* The self voice — the spectator */}
                {c.self_voice && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${SEVERITY_COLOR[3] ?? "#fbb86d"}` }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Who's narrating
                    </div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.4, fontStyle: "italic" }}>
                      {c.self_voice}
                    </div>
                  </div>
                )}

                {/* Recurrence samples */}
                {c.recurrence_samples.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Earlier moments in the window
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {c.recurrence_samples.map((m, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#bfb5a8", padding: "6px 10px", background: "#0f0d0a", borderLeft: `1px solid ${kTint}33`, lineHeight: 1.45 }}>
                          <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", marginRight: 8 }}>{m.date}</span>
                          <span style={{ fontStyle: "italic" }}>{m.snippet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reclaimed phrase (if status='reclaimed', the note IS the I-form rewrite) */}
                {c.status === "reclaimed" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.reclaimed}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.reclaimed, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>The way you reclaimed it · in I-form, active voice</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}

                {/* Existing status note for non-reclaimed cases */}
                {c.status !== "reclaimed" && c.status_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic", marginBottom: 8 }}>
                    your note: {c.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {resolveOpenId === c.id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2620" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["reclaimed", "kept", "noted", "dismissed"] as const).map((s) => {
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
                        resolveStatus === "reclaimed"
                          ? `Rewrite it as I, in active voice. The depression hit -> I'm depressed. The chest tightens -> my chest is tight. You know that feeling -> I feel that. Required for 'reclaimed'.`
                          : resolveStatus === "kept"
                          ? `Why are you keeping the disowned framing? (optional)`
                          : "optional note..."
                      }
                      rows={resolveStatus === "reclaimed" ? 4 : 2}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: resolveStatus === "reclaimed" ? "Georgia, serif" : "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          if (resolveStatus === "reclaimed" && resolveNote.trim().length === 0) {
                            setError("type the I-form rewrite before saving");
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
                    {c.status === "pending" && (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("reclaimed"); setResolveNote(c.status_note ?? c.what_was_disowned ?? ""); }}
                          style={{ background: STATUS_COLOR.reclaimed, color: "#1c1815", border: `1px solid ${STATUS_COLOR.reclaimed}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          reclaim it as yours
                        </button>
                        {(["kept", "noted", "dismissed"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => { setResolveOpenId(c.id); setResolveStatus(s); setResolveNote(c.status_note ?? ""); }}
                            style={{ background: "transparent", color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                          >
                            {s}
                          </button>
                        ))}
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
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#5a544c" }}>{relTime(c.created_at)}</span>
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
              Mine the register
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Mines your messages in the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong> for moments you described your own life as if it were someone else&rsquo;s. Surfaces distancing pronouns (&ldquo;you know that feeling&rdquo;), external attribution (&ldquo;the depression hit&rdquo;), abstract body (&ldquo;the chest tightens&rdquo;), generic universals (&ldquo;everyone has this&rdquo;), and agentless passives (&ldquo;the gym wasn&rsquo;t visited&rdquo;) — and the spectator voice that did the narrating.
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>Window</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[30, 60, 90, 120, 180, 270, 365].map((days) => (
                  <button
                    key={days}
                    onClick={() => setComposeWindow(days)}
                    style={{
                      background: composeWindow === days ? "#7affcb" : "transparent",
                      color: composeWindow === days ? "#1c1815" : "#bfb5a8",
                      border: `1px solid ${composeWindow === days ? "#7affcb" : "#2a2620"}`,
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
