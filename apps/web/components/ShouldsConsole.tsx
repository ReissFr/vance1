"use client";

import { useCallback, useEffect, useState } from "react";

type RecurrenceSample = { date: string; snippet: string };

type ShouldKind = "moral" | "practical" | "social" | "relational" | "health" | "identity" | "work" | "financial";
type ObligationSource = "self" | "parent" | "partner" | "inner_critic" | "social_norm" | "professional_norm" | "financial_judge" | "abstract_other";
type Domain =
  | "work" | "relationships" | "health" | "identity"
  | "finance" | "creative" | "learning" | "daily" | "other";
type Status = "pending" | "done" | "released" | "converted" | "noted" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterKind = ShouldKind | "all";
type FilterSource = ObligationSource | "all";
type FilterDomain = Domain | "all";

type Should = {
  id: string;
  scan_id: string;
  should_text: string;
  should_kind: ShouldKind;
  distilled_obligation: string;
  obligation_source: ObligationSource;
  charge_score: number;
  domain: Domain;
  spoken_date: string;
  spoken_message_id: string | null;
  spoken_conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_with_charge: number;
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

type SourceRanked = { source: string; rows: number; chronic_rows: number; total_recurrence: number; avg_charge: number };
type KindRanked = { kind: string; rows: number; chronic_rows: number; total_recurrence: number; avg_charge: number };

type Stats = {
  total: number;
  pending: number;
  done: number;
  released: number;
  converted: number;
  noted: number;
  dismissed: number;
  chronic_should: number;
  high_charge: number;
  inner_critic_count: number;
  parent_count: number;
  self_count: number;
  source_counts_ranked: SourceRanked[];
  kind_counts_ranked: KindRanked[];
  kind_counts: Record<ShouldKind, number>;
  source_counts: Record<ObligationSource, number>;
  domain_counts: Record<Domain, number>;
};

const KIND_LABEL: Record<ShouldKind, string> = {
  moral: "MORAL OUGHT",
  practical: "PRACTICAL CHORE",
  social: "SOCIAL CALL-BACK",
  relational: "RELATIONAL DEBT",
  health: "HEALTH RESOLVE",
  identity: "IDENTITY DEMAND",
  work: "WORK PRESSURE",
  financial: "FINANCIAL MORAL",
};

const KIND_COLOR: Record<ShouldKind, string> = {
  moral: "#c9b3f4",
  practical: "#bfd4ee",
  social: "#fbb86d",
  relational: "#f4c9d8",
  health: "#7affcb",
  identity: "#f4577a",
  work: "#ffd966",
  financial: "#b8c9b8",
};

const SOURCE_LABEL: Record<ObligationSource, string> = {
  self: "YOUR OWN VALUE",
  parent: "A PARENT'S VOICE",
  partner: "YOUR PARTNER",
  inner_critic: "YOUR INNER CRITIC",
  social_norm: "SOCIAL NORM",
  professional_norm: "PROFESSIONAL NORM",
  financial_judge: "FINANCIAL JUDGE",
  abstract_other: "ABSTRACT OTHER",
};

const SOURCE_COLOR: Record<ObligationSource, string> = {
  self: "#7affcb",
  parent: "#fbb86d",
  partner: "#f4c9d8",
  inner_critic: "#f4577a",
  social_norm: "#bfd4ee",
  professional_norm: "#ffd966",
  financial_judge: "#b8c9b8",
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
  1: "ISOLATED",
  2: "EMERGING",
  3: "HABITUAL",
  4: "ENTRENCHED",
  5: "CHRONIC",
};

const SEVERITY_BLURB: Record<number, string> = {
  1: "you mentioned this once",
  2: "this should keeps coming back",
  3: "you carry this often · the obligation is alive in your writing",
  4: "you keep telling yourself this · entrenched ought",
  5: "this is chronic · you have carried this should for a long time",
};

const CHARGE_LABEL: Record<number, string> = {
  1: "casual",
  2: "mild",
  3: "clear",
  4: "guilt-tinged",
  5: "guilt-saturated",
};

const CHARGE_COLOR: Record<number, string> = {
  1: "#9aa28e",
  2: "#bfb5a8",
  3: "#fbb86d",
  4: "#f4a8a8",
  5: "#f4577a",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  done: "#7affcb",
  released: "#7affcb",
  converted: "#fbb86d",
  noted: "#e8e0d2",
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

export function ShouldsConsole() {
  const [rows, setRows] = useState<Should[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [sourceFilter, setSourceFilter] = useState<FilterSource>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minSeverity, setMinSeverity] = useState<number>(1);
  const [minCharge, setMinCharge] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(120);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Status>("released");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("kind", kindFilter);
      params.set("source", sourceFilter);
      params.set("domain", domainFilter);
      params.set("min_severity", String(minSeverity));
      params.set("min_charge", String(minCharge));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "100");
      const r = await fetch(`/api/shoulds?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { shoulds: Should[]; stats: Stats };
      setRows(j.shoulds);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, sourceFilter, domainFilter, minSeverity, minCharge, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/shoulds/scan`, {
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
      const r = await fetch(`/api/shoulds/${id}`, {
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
          {stats ? `${stats.total} shoulds on file · ${stats.chronic_should} chronic · ${stats.high_charge} guilt-saturated` : ""}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: "#7affcb", color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          Mine the ledger
        </button>
      </div>

      {/* Headline stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <Stat label="chronic shoulds" value={stats.chronic_should} colour={SEVERITY_COLOR[5] ?? "#f4577a"} big />
          <Stat label="guilt-saturated" value={stats.high_charge} colour={CHARGE_COLOR[4] ?? "#f4a8a8"} big />
          <Stat label="from inner critic" value={stats.inner_critic_count} colour={SOURCE_COLOR.inner_critic} />
          <Stat label="from parent voice" value={stats.parent_count} colour={SOURCE_COLOR.parent} />
          <Stat label="released as theirs" value={stats.released} colour={STATUS_COLOR.released} />
        </div>
      )}

      {/* Top sources — whose voice puts these shoulds there */}
      {stats && stats.source_counts_ranked.length > 0 && (
        <div style={{ marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            Whose voice puts shoulds in your head
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.source_counts_ranked.map((s) => {
              const ss = s.source as ObligationSource;
              const c = SOURCE_COLOR[ss] ?? "#bfb5a8";
              const lbl = SOURCE_LABEL[ss] ?? s.source;
              const chronicHeavy = s.chronic_rows > 0;
              return (
                <div
                  key={s.source}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: `1px solid ${c}`,
                    padding: "5px 10px",
                    background: "#0f0d0a",
                  }}
                >
                  <span style={{ fontSize: 10, color: c, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700 }}>{lbl}</span>
                  <span style={{ fontSize: 11, color: "#bfb5a8" }}>{s.rows} {s.rows === 1 ? "row" : "rows"} · ×{s.total_recurrence}</span>
                  <span style={{ fontSize: 10, color: CHARGE_COLOR[Math.round(s.avg_charge)] ?? "#bfb5a8", fontStyle: "italic" }}>avg charge {s.avg_charge}</span>
                  {chronicHeavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 1, textTransform: "uppercase" }}>{s.chronic_rows} chronic</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top kinds — what kinds of obligation does the user carry */}
      {stats && stats.kind_counts_ranked.length > 0 && (
        <div style={{ marginBottom: 18, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            What kinds of obligation you carry
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.kind_counts_ranked.map((k) => {
              const kk = k.kind as ShouldKind;
              const c = KIND_COLOR[kk] ?? "#bfb5a8";
              const lbl = KIND_LABEL[kk] ?? k.kind;
              const chronicHeavy = k.chronic_rows > 0;
              return (
                <div
                  key={k.kind}
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
                  <span style={{ fontSize: 11, color: "#bfb5a8" }}>{k.rows} {k.rows === 1 ? "row" : "rows"} · ×{k.total_recurrence}</span>
                  <span style={{ fontSize: 10, color: CHARGE_COLOR[Math.round(k.avg_charge)] ?? "#bfb5a8", fontStyle: "italic" }}>avg charge {k.avg_charge}</span>
                  {chronicHeavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 1, textTransform: "uppercase" }}>{k.chronic_rows} chronic</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {(["pending", "done", "released", "converted", "noted", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
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
        {(["all", "moral", "practical", "social", "relational", "health", "identity", "work", "financial"] as const).map((k) => {
          const active = kindFilter === k;
          const c = k === "all" ? "#bfb5a8" : KIND_COLOR[k as ShouldKind];
          const count = stats && k !== "all" ? stats.kind_counts[k as ShouldKind] : null;
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
              {k}{count != null ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Source filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Voice:</span>
        {(["all", "self", "parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "abstract_other"] as const).map((s) => {
          const active = sourceFilter === s;
          const c = s === "all" ? "#bfb5a8" : SOURCE_COLOR[s as ObligationSource];
          const count = stats && s !== "all" ? stats.source_counts[s as ObligationSource] : null;
          const lbl = s === "all" ? "all" : s.replace(/_/g, " ");
          return (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
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

      {/* Min severity + min charge + min confidence */}
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
          <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min charge:</span>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = minCharge === n;
            const c = CHARGE_COLOR[n] ?? "#bfb5a8";
            return (
              <button
                key={n}
                onClick={() => setMinCharge(n)}
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
          scan complete · {scanResult.inserted} new shoulds surfaced · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.should_candidates != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.should_candidates} candidate moments, {scanResult.signals.shoulds_extracted ?? 0} valid</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "no scan yet — run one to surface every 'I should' you have typed and the voices behind them" : "no shoulds match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((c) => {
            const sevTint = SEVERITY_COLOR[c.pattern_severity] ?? "#bfb5a8";
            const chargeTint = CHARGE_COLOR[c.charge_score] ?? "#bfb5a8";
            const kTint = KIND_COLOR[c.should_kind];
            const dTint = DOMAIN_COLOR[c.domain];
            const sTint = SOURCE_COLOR[c.obligation_source];
            const statusColour = STATUS_COLOR[c.status];
            const isReleased = c.status === "released";
            const isDone = c.status === "done";
            const tint = isReleased || isDone ? STATUS_COLOR.released : sevTint;
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
                    <span style={{ fontSize: 10, fontWeight: 700, color: kTint, letterSpacing: 1.6, textTransform: "uppercase" }}>{KIND_LABEL[c.should_kind]}</span>
                    <span style={{ fontSize: 9, color: sTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${sTint}`, padding: "1px 5px" }}>{SOURCE_LABEL[c.obligation_source]}</span>
                    <span style={{ fontSize: 9, color: dTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${dTint}`, padding: "1px 5px" }}>{c.domain}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sevTint, letterSpacing: 1.6, textTransform: "uppercase" }}>· {SEVERITY_LABEL[c.pattern_severity] ?? ""}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: chargeTint, letterSpacing: 1.6, textTransform: "uppercase", border: `1px solid ${chargeTint}`, padding: "1px 5px" }}>charge: {CHARGE_LABEL[c.charge_score]}</span>
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

                {/* The verbatim should phrase */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${kTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    What you typed
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 24, color: "#e8e0d2", lineHeight: 1.3, fontStyle: "italic" }}>
                    &ldquo;{c.should_text}&rdquo;
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    {c.recurrence_count > 1 ? (
                      <div style={{ fontSize: 11, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 0.4 }}>
                        you said this same shape {c.recurrence_count} times · across {c.recurrence_days} day{c.recurrence_days === 1 ? "" : "s"}{c.recurrence_with_charge > 1 ? ` · ${c.recurrence_with_charge} of those alongside guilt words (guilty, feel bad, keep meaning to)` : ""}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#5a544c", letterSpacing: 0.4 }}>first time this should has surfaced in the window</div>
                    )}
                  </div>
                </div>

                {/* The distilled obligation */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${sTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    The obligation, distilled
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.5 }}>
                    {c.distilled_obligation}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: "#8a8378", fontStyle: "italic" }}>
                    voice: <span style={{ color: sTint, textTransform: "uppercase", letterSpacing: 1.2, fontStyle: "normal", fontWeight: 700 }}>{SOURCE_LABEL[c.obligation_source]}</span>
                  </div>
                </div>

                {/* Recurrence samples */}
                {c.recurrence_samples.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Earlier mentions of the same should
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

                {/* Status note for resolved rows */}
                {c.status === "released" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.released}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.released, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>Why this isn&apos;t yours to carry</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {c.status === "converted" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.converted}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.converted, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>The action you committed to</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {c.status === "done" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.done}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.done, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>How you handled it</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 16, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {(c.status === "noted" || c.status === "dismissed") && c.status_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic", marginBottom: 8 }}>
                    your note: {c.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {resolveOpenId === c.id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2620" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["released", "converted", "done", "noted", "dismissed"] as const).map((s) => {
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
                        resolveStatus === "released"
                          ? `Why isn't this yours to carry? Whose voice is it? "This isn't my standard, it's my mum's. I don't endorse it." Required for 'released'.`
                          : resolveStatus === "converted"
                          ? `What's the concrete action and when? "I'll call mum on Sunday at 6pm." "I'll book a GP appointment tomorrow morning." Required for 'converted'.`
                          : resolveStatus === "done"
                          ? `How did you handle it? (optional)`
                          : "optional note..."
                      }
                      rows={resolveStatus === "released" || resolveStatus === "converted" ? 4 : 3}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: resolveStatus === "released" ? "Georgia, serif" : "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          if (resolveStatus === "released" && resolveNote.trim().length === 0) {
                            setError("type why this isn't yours to carry before saving");
                            return;
                          }
                          if (resolveStatus === "converted" && resolveNote.trim().length === 0) {
                            setError("type the concrete action and when before saving");
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
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("released"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: STATUS_COLOR.released, color: "#1c1815", border: `1px solid ${STATUS_COLOR.released}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          release it
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("converted"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: STATUS_COLOR.converted, color: "#1c1815", border: `1px solid ${STATUS_COLOR.converted}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          do it
                        </button>
                        {(["done", "noted", "dismissed"] as const).map((s) => (
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
              Mine the ledger
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Mines your messages in the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong> for every &ldquo;I should ___&rdquo;, &ldquo;I ought to ___&rdquo;, &ldquo;I need to ___&rdquo; you have typed about yourself. Surfaces moral oughts, practical chores, social call-backs, relational debts, health resolves, identity demands, work pressures and financial morals. Each gets a charge score and a guess at whose voice put it there. The release valve invites you to consciously let go of the ones that aren&apos;t actually yours to carry.
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
