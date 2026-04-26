"use client";

import { useCallback, useEffect, useState } from "react";

type RecurrenceSample = { date: string; snippet: string };

type RequestKind = "explicit_permission" | "justification" | "self_doubt" | "comparison_to_norm" | "future_excuse";
type Authority = "self_judge" | "partner" | "parent" | "professional_norm" | "social_norm" | "friend" | "work_authority" | "financial_judge" | "abstract_other";
type Domain =
  | "work" | "relationships" | "health" | "identity"
  | "finance" | "creative" | "learning" | "daily" | "other";
type Status = "pending" | "acknowledged" | "contested" | "granted" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterKind = RequestKind | "all";
type FilterAuthority = Authority | "all";
type FilterDomain = Domain | "all";

type Seeking = {
  id: string;
  scan_id: string;
  request_text: string;
  request_kind: RequestKind;
  requested_action: string;
  action_aliases: string[];
  implicit_authority: Authority;
  urgency_score: number;
  domain: Domain;
  spoken_date: string;
  spoken_message_id: string | null;
  spoken_conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
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

type ActionCount = { action: string; recurrence: number; chronic_rows: number; authorities: string[] };
type AuthorityCount = { authority: string; rows: number; chronic_rows: number; total_recurrence: number };

type Stats = {
  total: number;
  pending: number;
  acknowledged: number;
  contested: number;
  granted: number;
  dismissed: number;
  chronic_seeking: number;
  high_urgency: number;
  kind_counts: Record<RequestKind, number>;
  authority_counts: AuthorityCount[];
  domain_counts: Record<Domain, number>;
  action_counts: ActionCount[];
};

const KIND_LABEL: Record<RequestKind, string> = {
  explicit_permission: "EXPLICIT",
  justification: "JUSTIFICATION",
  self_doubt: "SELF DOUBT",
  comparison_to_norm: "VS THE NORM",
  future_excuse: "FUTURE EXCUSE",
};

const KIND_COLOR: Record<RequestKind, string> = {
  explicit_permission: "#fbb86d",
  justification: "#bfd4ee",
  self_doubt: "#f4a8a8",
  comparison_to_norm: "#c9b3f4",
  future_excuse: "#e8e0d2",
};

const AUTHORITY_LABEL: Record<Authority, string> = {
  self_judge: "INNER CRITIC",
  partner: "PARTNER",
  parent: "PARENT",
  professional_norm: "PROFESSIONAL NORM",
  social_norm: "SOCIAL NORM",
  friend: "FRIENDS",
  work_authority: "WORK / BUSINESS",
  financial_judge: "MONEY JUDGE",
  abstract_other: "ABSTRACT OTHER",
};

const AUTHORITY_COLOR: Record<Authority, string> = {
  self_judge: "#f4577a",
  partner: "#f4c9d8",
  parent: "#f4a8a8",
  professional_norm: "#bfd4ee",
  social_norm: "#c9b3f4",
  friend: "#fbb86d",
  work_authority: "#ffd966",
  financial_judge: "#7affcb",
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
  3: "RECURRING",
  4: "ENTRENCHED",
  5: "CHRONIC",
};

const SEVERITY_BLURB: Record<number, string> = {
  1: "one moment · not yet a pattern",
  2: "starting to come back · watch this",
  3: "you keep asking permission for this",
  4: "you've sought permission for this many times",
  5: "this is the authority you keep deferring to · always · in the same shape",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  acknowledged: "#7affcb",
  contested: "#fbb86d",
  granted: "#c9b3f4",
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

export function PermissionLedgerConsole() {
  const [rows, setRows] = useState<Seeking[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [authorityFilter, setAuthorityFilter] = useState<FilterAuthority>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minSeverity, setMinSeverity] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [minUrgency, setMinUrgency] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(120);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Status>("granted");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("kind", kindFilter);
      params.set("authority", authorityFilter);
      params.set("domain", domainFilter);
      params.set("min_severity", String(minSeverity));
      params.set("min_confidence", String(minConfidence));
      params.set("min_urgency", String(minUrgency));
      params.set("limit", "100");
      const r = await fetch(`/api/permission-ledger?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { seekings: Seeking[]; stats: Stats };
      setRows(j.seekings);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, authorityFilter, domainFilter, minSeverity, minConfidence, minUrgency]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/permission-ledger/scan`, {
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
      const r = await fetch(`/api/permission-ledger/${id}`, {
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
          {stats ? `${stats.total} seekings · ${stats.chronic_seeking} chronic · ${stats.high_urgency} highly charged` : ""}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: "#c9b3f4", color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          Mine the ledger
        </button>
      </div>

      {/* Headline stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <Stat label="chronic seeking" value={stats.chronic_seeking} colour={SEVERITY_COLOR[5] ?? "#f4577a"} big />
          <Stat label="highly charged" value={stats.high_urgency} colour={SEVERITY_COLOR[4] ?? "#f4a8a8"} big />
          <Stat label="explicit asks" value={stats.kind_counts.explicit_permission} colour={KIND_COLOR.explicit_permission} />
          <Stat label="self doubt" value={stats.kind_counts.self_doubt} colour={KIND_COLOR.self_doubt} />
          <Stat label="granted" value={stats.granted} colour={STATUS_COLOR.granted} />
        </div>
      )}

      {/* Top authorities panel — who you defer to most */}
      {stats && stats.authority_counts.length > 0 && (
        <div style={{ marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            Audiences you imagine might disapprove
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.authority_counts.map((a) => {
              const c = AUTHORITY_COLOR[a.authority as Authority] ?? "#bfb5a8";
              const label = AUTHORITY_LABEL[a.authority as Authority] ?? a.authority;
              const chronicHeavy = a.chronic_rows > 0;
              return (
                <div
                  key={a.authority}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: `1px solid ${c}`,
                    padding: "5px 10px",
                    background: "#0f0d0a",
                  }}
                >
                  <span style={{ fontSize: 10, color: c, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700 }}>{label}</span>
                  <span style={{ fontSize: 11, color: "#bfb5a8" }}>{a.rows} {a.rows === 1 ? "row" : "rows"} · ×{a.total_recurrence}</span>
                  {chronicHeavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 1, textTransform: "uppercase" }}>{a.chronic_rows} chronic</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top actions panel — what you keep asking permission FOR */}
      {stats && stats.action_counts.length > 0 && (
        <div style={{ marginBottom: 18, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            Things you keep seeking permission for
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.action_counts.map((t) => {
              const chronicHeavy = t.chronic_rows > 0;
              const c = chronicHeavy ? SEVERITY_COLOR[5] ?? "#f4577a" : "#bfb5a8";
              return (
                <div
                  key={t.action}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: `1px solid ${c}`,
                    padding: "5px 10px",
                    background: "#0f0d0a",
                  }}
                >
                  <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", color: "#e8e0d2", fontSize: 13 }}>{t.action}</span>
                  <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>×{t.recurrence}</span>
                  {chronicHeavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 1, textTransform: "uppercase" }}>chronic</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {(["pending", "acknowledged", "contested", "granted", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
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
        {(["all", "explicit_permission", "justification", "self_doubt", "comparison_to_norm", "future_excuse"] as const).map((k) => {
          const active = kindFilter === k;
          const c = k === "all" ? "#bfb5a8" : KIND_COLOR[k as RequestKind];
          const count = stats && k !== "all" ? stats.kind_counts[k as RequestKind] : null;
          const lbl = k === "all" ? "all" : KIND_LABEL[k as RequestKind].toLowerCase();
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

      {/* Authority filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Authority:</span>
        {(["all", "self_judge", "partner", "parent", "professional_norm", "social_norm", "friend", "work_authority", "financial_judge", "abstract_other"] as const).map((a) => {
          const active = authorityFilter === a;
          const c = a === "all" ? "#bfb5a8" : AUTHORITY_COLOR[a as Authority];
          const lbl = a === "all" ? "all" : AUTHORITY_LABEL[a as Authority].toLowerCase();
          return (
            <button
              key={a}
              onClick={() => setAuthorityFilter(a)}
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

      {/* Min severity + min confidence + min urgency */}
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
          <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min urgency:</span>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = minUrgency === n;
            return (
              <button
                key={n}
                onClick={() => setMinUrgency(n)}
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
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min confidence:</span>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = minConfidence === n;
            return (
              <button
                key={n}
                onClick={() => setMinConfidence(n)}
                style={{
                  background: active ? "#c9b3f4" : "transparent",
                  color: active ? "#1c1815" : "#c9b3f4",
                  border: `1px solid #c9b3f4`,
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
        <div style={{ background: "#171411", border: "1px solid #c9b3f4", padding: 12, marginBottom: 14, fontSize: 12, color: "#e8e0d2" }}>
          scan complete · {scanResult.inserted} new seekings surfaced · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.seeking_candidates != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.seeking_candidates} candidate moments, {scanResult.signals.seekings_extracted ?? 0} valid</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "no scan yet — run one to surface what you keep seeking permission for" : "no seekings match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((c) => {
            const sevTint = SEVERITY_COLOR[c.pattern_severity] ?? "#bfb5a8";
            const kTint = KIND_COLOR[c.request_kind];
            const dTint = DOMAIN_COLOR[c.domain];
            const aTint = AUTHORITY_COLOR[c.implicit_authority];
            const statusColour = STATUS_COLOR[c.status];
            const isGranted = c.status === "granted";
            const tint = isGranted ? STATUS_COLOR.granted : sevTint;
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
                    <span style={{ fontSize: 10, fontWeight: 700, color: kTint, letterSpacing: 1.6, textTransform: "uppercase" }}>{KIND_LABEL[c.request_kind]}</span>
                    <span style={{ fontSize: 9, color: aTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${aTint}`, padding: "1px 5px" }}>{AUTHORITY_LABEL[c.implicit_authority]}</span>
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

                {/* The action — large headline */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${kTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    Asked permission to
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 24, color: "#e8e0d2", lineHeight: 1.3, fontStyle: "italic" }}>
                    {c.requested_action}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    {c.recurrence_count > 1 ? (
                      <div style={{ fontSize: 11, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 0.4 }}>
                        sought permission for this {c.recurrence_count} times · across {c.recurrence_days} day{c.recurrence_days === 1 ? "" : "s"}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#5a544c", letterSpacing: 0.4 }}>first time this seeking has surfaced in the window</div>
                    )}
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase" }}>urgency:</span>
                      {dotMeter(c.urgency_score, c.urgency_score >= 4 ? SEVERITY_COLOR[5] ?? "#f4577a" : c.urgency_score === 3 ? "#fbb86d" : "#bfb5a8")}
                    </div>
                  </div>
                </div>

                {/* The verbatim seeking */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${aTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    What you said
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 16, color: "#e8e0d2", lineHeight: 1.5, fontStyle: "italic" }}>
                    &ldquo;{c.request_text}&rdquo;
                  </div>
                </div>

                {/* Recurrence samples — prior seekings about the same action */}
                {c.recurrence_samples.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Earlier moments in the window
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {c.recurrence_samples.map((m, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#bfb5a8", padding: "6px 10px", background: "#0f0d0a", borderLeft: `1px solid ${aTint}33`, lineHeight: 1.45 }}>
                          <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", marginRight: 8 }}>{m.date}</span>
                          <span style={{ fontStyle: "italic" }}>{m.snippet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Aliases */}
                {c.action_aliases.length > 0 && (
                  <div style={{ fontSize: 10, color: "#5a544c", marginBottom: 12, lineHeight: 1.5 }}>
                    matched aliases: <span style={{ fontFamily: "ui-monospace, monospace", color: "#8a8378" }}>{c.action_aliases.join(" / ")}</span>
                  </div>
                )}

                {/* Self-permission grant (if status='granted', the note IS the grant) */}
                {c.status === "granted" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.granted}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.granted, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>Your self-permission grant</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 15, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}

                {/* Existing status note for non-granted cases */}
                {c.status !== "granted" && c.status_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic", marginBottom: 8 }}>
                    your note: {c.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {resolveOpenId === c.id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2620" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["granted", "acknowledged", "contested", "dismissed"] as const).map((s) => {
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
                      placeholder={resolveStatus === "granted" ? `Write your self-permission grant: "I am allowed to ${c.requested_action}. I do not need permission for this." Make it your own — required for 'granted'.` : "optional note..."}
                      rows={resolveStatus === "granted" ? 4 : 2}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: resolveStatus === "granted" ? "Georgia, serif" : "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          if (resolveStatus === "granted" && resolveNote.trim().length === 0) {
                            setError("write your self-permission grant before saving");
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
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("granted"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: STATUS_COLOR.granted, color: "#1c1815", border: `1px solid ${STATUS_COLOR.granted}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          grant yourself permission
                        </button>
                        {(["acknowledged", "contested", "dismissed"] as const).map((s) => (
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
                        restore
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
            style={{ background: "#171411", border: "1px solid #c9b3f4", padding: 24, width: "min(440px, 92vw)" }}
          >
            <div style={{ fontSize: 13, color: "#c9b3f4", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 12 }}>
              Mine the ledger
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Mines your messages in the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong> for moments you sought authorisation for things you shouldn&rsquo;t actually have needed permission for. Surfaces explicit asks (&ldquo;is it ok if&rdquo;), justifications (&ldquo;I shouldn&rsquo;t but&rdquo;), self-doubt (&ldquo;is it bad that I&rdquo;), comparisons to the norm (&ldquo;do most people&rdquo;), and pre-emptive future excuses (&ldquo;I&rsquo;m gonna but&rdquo;) — and the audiences you imagine might disapprove.
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>Window</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[30, 60, 90, 120, 180, 270, 365].map((days) => (
                  <button
                    key={days}
                    onClick={() => setComposeWindow(days)}
                    style={{
                      background: composeWindow === days ? "#c9b3f4" : "transparent",
                      color: composeWindow === days ? "#1c1815" : "#bfb5a8",
                      border: `1px solid ${composeWindow === days ? "#c9b3f4" : "#2a2620"}`,
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
                  background: scanning ? "#3a342c" : "#c9b3f4",
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
