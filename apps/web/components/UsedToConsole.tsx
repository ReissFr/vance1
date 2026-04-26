"use client";

import { useCallback, useEffect, useState } from "react";

type RecurrenceSample = { date: string; snippet: string };

type UsedToKind = "hobby" | "habit" | "capability" | "relationship" | "place" | "identity" | "belief" | "role" | "ritual";
type TargetKind = "activity" | "practice" | "trait" | "person_or_bond" | "location" | "self_concept" | "assumption" | "responsibility" | "rhythm";
type Domain =
  | "work" | "relationships" | "health" | "identity"
  | "finance" | "creative" | "learning" | "daily" | "other";
type Status = "pending" | "reclaimed" | "grieved" | "let_go" | "noted" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterKind = UsedToKind | "all";
type FilterTarget = TargetKind | "all";
type FilterDomain = Domain | "all";

type UsedTo = {
  id: string;
  scan_id: string;
  used_to_text: string;
  used_to_kind: UsedToKind;
  what_was: string | null;
  what_was_kind: TargetKind | null;
  longing_score: number;
  domain: Domain;
  spoken_date: string;
  message_id: string | null;
  conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_with_longing: number;
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

type KindRanked = { kind: string; rows: number; chronic_rows: number; total_recurrence: number; avg_longing: number };
type TargetCount = { target: string; rows: number; chronic_rows: number; total_recurrence: number; avg_longing: number };

type Stats = {
  total: number;
  pending: number;
  reclaimed: number;
  grieved: number;
  let_go: number;
  noted: number;
  dismissed: number;
  chronic_mourning: number;
  high_longing: number;
  lost_hobbies: number;
  lost_relationships: number;
  lost_identities: number;
  kind_counts: Record<UsedToKind, number>;
  kind_counts_ranked: KindRanked[];
  target_counts: TargetCount[];
  domain_counts: Record<Domain, number>;
};

const KIND_LABEL: Record<UsedToKind, string> = {
  hobby: "HOBBY YOU STOPPED",
  habit: "HABIT YOU LET DROP",
  capability: "CAPABILITY YOU LOST",
  relationship: "PERSON YOU NO LONGER TALK TO",
  place: "PLACE YOU LEFT",
  identity: "IDENTITY YOU SHED",
  belief: "BELIEF YOU OUTGREW",
  role: "ROLE YOU HANDED BACK",
  ritual: "RITUAL YOU BROKE",
};

const KIND_COLOR: Record<UsedToKind, string> = {
  hobby: "#fbb86d",
  habit: "#bfd4ee",
  capability: "#f4577a",
  relationship: "#f4c9d8",
  place: "#7affcb",
  identity: "#c9b3f4",
  belief: "#b8c9b8",
  role: "#ffd966",
  ritual: "#e8e0d2",
};

const TARGET_LABEL: Record<TargetKind, string> = {
  activity: "AN ACTIVITY",
  practice: "A PRACTICE",
  trait: "A TRAIT",
  person_or_bond: "A PERSON OR BOND",
  location: "A LOCATION",
  self_concept: "A SELF-CONCEPT",
  assumption: "AN ASSUMPTION",
  responsibility: "A RESPONSIBILITY",
  rhythm: "A RHYTHM",
};

const TARGET_COLOR: Record<TargetKind, string> = {
  activity: "#fbb86d",
  practice: "#bfd4ee",
  trait: "#f4577a",
  person_or_bond: "#f4c9d8",
  location: "#7affcb",
  self_concept: "#c9b3f4",
  assumption: "#b8c9b8",
  responsibility: "#ffd966",
  rhythm: "#e8e0d2",
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
  2: "you bring this up periodically",
  3: "you mention this often · the lost self is alive in your writing",
  4: "you keep mentioning this with longing · entrenched mourning",
  5: "this is chronic · you mourn this version of yourself again and again",
};

const LONGING_LABEL: Record<number, string> = {
  1: "neutral",
  2: "mild reminisce",
  3: "mild longing",
  4: "clear longing",
  5: "mourning",
};

const LONGING_COLOR: Record<number, string> = {
  1: "#9aa28e",
  2: "#bfb5a8",
  3: "#fbb86d",
  4: "#f4a8a8",
  5: "#f4577a",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  reclaimed: "#7affcb",
  grieved: "#c9b3f4",
  let_go: "#bfd4ee",
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

export function UsedToConsole() {
  const [rows, setRows] = useState<UsedTo[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [targetFilter, setTargetFilter] = useState<FilterTarget>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minSeverity, setMinSeverity] = useState<number>(1);
  const [minLonging, setMinLonging] = useState<number>(1);
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
      params.set("min_longing", String(minLonging));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "100");
      const r = await fetch(`/api/used-to?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { used_tos: UsedTo[]; stats: Stats };
      setRows(j.used_tos);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, targetFilter, domainFilter, minSeverity, minLonging, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/used-to/scan`, {
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
      const r = await fetch(`/api/used-to/${id}`, {
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
          {stats ? `${stats.total} lost selves on file · ${stats.chronic_mourning} chronic mourning · ${stats.high_longing} high longing` : ""}
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
          <Stat label="chronic mourning" value={stats.chronic_mourning} colour={SEVERITY_COLOR[5] ?? "#f4577a"} big />
          <Stat label="high longing" value={stats.high_longing} colour={LONGING_COLOR[4] ?? "#f4a8a8"} big />
          <Stat label="lost hobbies" value={stats.lost_hobbies} colour={KIND_COLOR.hobby} />
          <Stat label="lost relationships" value={stats.lost_relationships} colour={KIND_COLOR.relationship} />
          <Stat label="reclaimed" value={stats.reclaimed} colour={STATUS_COLOR.reclaimed} />
        </div>
      )}

      {/* Top kinds — what kinds of past-self does the user mention most */}
      {stats && stats.kind_counts_ranked.length > 0 && (
        <div style={{ marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            The kinds of past-self you keep returning to
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stats.kind_counts_ranked.map((k) => {
              const kk = k.kind as UsedToKind;
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
                  <span style={{ fontSize: 10, color: c, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700 }}>{lbl}</span>
                  <span style={{ fontSize: 11, color: "#bfb5a8" }}>{k.rows} {k.rows === 1 ? "row" : "rows"} · ×{k.total_recurrence}</span>
                  <span style={{ fontSize: 10, color: LONGING_COLOR[Math.round(k.avg_longing)] ?? "#bfb5a8", fontStyle: "italic" }}>avg longing {k.avg_longing}</span>
                  {chronicHeavy && (
                    <span style={{ fontSize: 9, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 1, textTransform: "uppercase" }}>{k.chronic_rows} chronic</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* What kinds of lost-thing — activity / practice / trait / person */}
      {stats && stats.target_counts.length > 0 && (
        <div style={{ marginBottom: 18, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
            What kinds of thing you lost
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
                  <span style={{ fontSize: 10, color: LONGING_COLOR[Math.round(t.avg_longing)] ?? "#bfb5a8", fontStyle: "italic" }}>avg longing {t.avg_longing}</span>
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
        {(["pending", "reclaimed", "grieved", "let_go", "noted", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
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
              {s === "let_go" ? "let go" : s}
            </button>
          );
        })}
      </div>

      {/* Kind filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Kind:</span>
        {(["all", "hobby", "habit", "capability", "relationship", "place", "identity", "belief", "role", "ritual"] as const).map((k) => {
          const active = kindFilter === k;
          const c = k === "all" ? "#bfb5a8" : KIND_COLOR[k as UsedToKind];
          const count = stats && k !== "all" ? stats.kind_counts[k as UsedToKind] : null;
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

      {/* Target filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Lost:</span>
        {(["all", "activity", "practice", "trait", "person_or_bond", "location", "self_concept", "assumption", "responsibility", "rhythm"] as const).map((t) => {
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

      {/* Min severity + min longing + min confidence */}
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
          <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min longing:</span>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = minLonging === n;
            const c = LONGING_COLOR[n] ?? "#bfb5a8";
            return (
              <button
                key={n}
                onClick={() => setMinLonging(n)}
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
          scan complete · {scanResult.inserted} new lost selves surfaced · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.used_to_candidates != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.used_to_candidates} candidate moments, {scanResult.signals.used_tos_extracted ?? 0} valid</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "no scan yet — run one to surface every 'I used to' you have typed and the lost selves they point to" : "no used-to statements match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((c) => {
            const sevTint = SEVERITY_COLOR[c.pattern_severity] ?? "#bfb5a8";
            const longTint = LONGING_COLOR[c.longing_score] ?? "#bfb5a8";
            const kTint = KIND_COLOR[c.used_to_kind];
            const dTint = DOMAIN_COLOR[c.domain];
            const tTint = c.what_was_kind ? TARGET_COLOR[c.what_was_kind] : "#bfb5a8";
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
                    <span style={{ fontSize: 10, fontWeight: 700, color: kTint, letterSpacing: 1.6, textTransform: "uppercase" }}>{KIND_LABEL[c.used_to_kind]}</span>
                    {c.what_was_kind && (
                      <span style={{ fontSize: 9, color: tTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tTint}`, padding: "1px 5px" }}>{TARGET_LABEL[c.what_was_kind]}</span>
                    )}
                    <span style={{ fontSize: 9, color: dTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${dTint}`, padding: "1px 5px" }}>{c.domain}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sevTint, letterSpacing: 1.6, textTransform: "uppercase" }}>· {SEVERITY_LABEL[c.pattern_severity] ?? ""}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: longTint, letterSpacing: 1.6, textTransform: "uppercase", border: `1px solid ${longTint}`, padding: "1px 5px" }}>longing: {LONGING_LABEL[c.longing_score]}</span>
                    <span style={{ fontSize: 11, color: "#5a544c", fontStyle: "italic" }}>{SEVERITY_BLURB[c.pattern_severity] ?? ""}</span>
                    {dotMeter(c.confidence, "#bfb5a8")}
                    {c.status !== "pending" && (
                      <span style={{ fontSize: 9, color: statusColour, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${statusColour}`, padding: "1px 5px" }}>
                        {c.status === "let_go" ? "let go" : c.status}
                      </span>
                    )}
                    {c.pinned && (
                      <span style={{ fontSize: 9, color: tint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tint}`, padding: "1px 5px" }}>pinned</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#5a544c" }}>spoken {c.spoken_date}</div>
                </div>

                {/* The verbatim used-to phrase */}
                <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${kTint}` }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                    What you typed
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 24, color: "#e8e0d2", lineHeight: 1.3, fontStyle: "italic" }}>
                    &ldquo;{c.used_to_text}&rdquo;
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    {c.recurrence_count > 1 ? (
                      <div style={{ fontSize: 11, color: SEVERITY_COLOR[5] ?? "#f4577a", letterSpacing: 0.4 }}>
                        you mentioned this same shape {c.recurrence_count} times · across {c.recurrence_days} day{c.recurrence_days === 1 ? "" : "s"}{c.recurrence_with_longing > 1 ? ` · ${c.recurrence_with_longing} of those alongside longing words (miss, wish, those days)` : ""}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#5a544c", letterSpacing: 0.4 }}>first time this past-self has surfaced in the window</div>
                    )}
                  </div>
                </div>

                {/* The distilled lost thing */}
                {c.what_was ? (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${tTint}` }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      What you used to have, do, or be
                    </div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.what_was}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${SEVERITY_COLOR[1] ?? "#9aa28e"}` }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      No specific lost thing distilled
                    </div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 14, color: "#8a8378", lineHeight: 1.5, fontStyle: "italic" }}>
                      what specifically did you lose here?
                    </div>
                  </div>
                )}

                {/* Recurrence samples */}
                {c.recurrence_samples.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Earlier mentions of the same past-self
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
                {c.status === "reclaimed" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.reclaimed}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.reclaimed, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>How you reclaimed it</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {c.status === "grieved" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.grieved}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.grieved, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>The grief sentence</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#e8e0d2", lineHeight: 1.5, fontStyle: "italic" }}>
                      {c.status_note}
                    </div>
                  </div>
                )}
                {c.status === "let_go" && c.status_note && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.let_go}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.let_go, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 4 }}>Why you let it go</div>
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
                      {(["reclaimed", "grieved", "let_go", "noted", "dismissed"] as const).map((s) => {
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
                            {s === "let_go" ? "let go" : s}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder={
                        resolveStatus === "reclaimed"
                          ? `What are you doing (or scheduling) to bring this back? Concrete. A 30-min slot tomorrow morning. A call this Sunday. The first step. Required for 'reclaimed'.`
                          : resolveStatus === "grieved"
                          ? `Name the grief. "I miss being someone who could focus for three hours." (optional but recommended)`
                          : resolveStatus === "let_go"
                          ? `Why are you letting this version of yourself go? (optional)`
                          : "optional note..."
                      }
                      rows={resolveStatus === "reclaimed" ? 4 : 3}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: resolveStatus === "reclaimed" || resolveStatus === "grieved" ? "Georgia, serif" : "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          if (resolveStatus === "reclaimed" && resolveNote.trim().length === 0) {
                            setError("type what you're doing to bring it back before saving");
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
                        save as {resolveStatus === "let_go" ? "let go" : resolveStatus}
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
                          onClick={() => { setResolveOpenId(c.id); setResolveStatus("reclaimed"); setResolveNote(c.status_note ?? ""); }}
                          style={{ background: STATUS_COLOR.reclaimed, color: "#1c1815", border: `1px solid ${STATUS_COLOR.reclaimed}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          bring it back
                        </button>
                        {(["grieved", "let_go", "noted", "dismissed"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => { setResolveOpenId(c.id); setResolveStatus(s); setResolveNote(c.status_note ?? ""); }}
                            style={{ background: "transparent", color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                          >
                            {s === "let_go" ? "let go" : s}
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
              Mines your messages in the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong> for every &ldquo;I used to ___&rdquo; you have typed about yourself. Surfaces hobbies, habits, capabilities, relationships, places, identities, beliefs, roles and rituals you have referenced as PAST. Each gets a longing score and a recurrence count. The reclaim mechanic invites you to put one concrete thing on the calendar.
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
