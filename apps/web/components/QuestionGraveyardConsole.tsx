"use client";

import { useCallback, useEffect, useState } from "react";

type ProposedAnswer = { date: string; snippet: string };

type QuestionKind = "decision" | "self_inquiry" | "meta" | "factual" | "hypothetical" | "rhetorical";
type Domain =
  | "work" | "relationships" | "health" | "identity"
  | "finance" | "creative" | "learning" | "daily" | "other";
type Status = "pending" | "acknowledged" | "answered" | "contested" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterAnswered = "any" | "true" | "false";
type FilterKind = QuestionKind | "all";
type FilterDomain = Domain | "all";

type Question = {
  id: string;
  scan_id: string;
  question_text: string;
  question_kind: QuestionKind;
  needs_answer: boolean;
  domain: Domain;
  asked_date: string;
  asked_message_id: string | null;
  asked_conversation_id: string | null;
  topic_aliases: string[];
  days_since_asked: number;
  asked_again_count: number;
  asked_again_days: number;
  answered: boolean;
  answer_text: string | null;
  answer_date: string | null;
  answer_message_id: string | null;
  days_to_answer: number | null;
  proposed_answer_excerpts: ProposedAnswer[];
  neglect_score: number;
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

type Stats = {
  total: number;
  pending: number;
  acknowledged: number;
  answered: number;
  contested: number;
  dismissed: number;
  unanswered: number;
  severely_neglected: number;
  strongly_neglected: number;
  kind_counts: Record<QuestionKind, number>;
  domain_counts: Record<Domain, number>;
};

const KIND_LABEL: Record<QuestionKind, string> = {
  decision: "DECISION",
  self_inquiry: "SELF-INQUIRY",
  meta: "META",
  factual: "FACTUAL",
  hypothetical: "HYPOTHETICAL",
  rhetorical: "RHETORICAL",
};

const KIND_COLOR: Record<QuestionKind, string> = {
  decision: "#fbb86d",
  self_inquiry: "#c9b3f4",
  meta: "#bfd4ee",
  factual: "#b8c9b8",
  hypothetical: "#e8e0d2",
  rhetorical: "#9aa28e",
};

const NEGLECT_COLOR: Record<number, string> = {
  1: "#9aa28e",
  2: "#b8c9b8",
  3: "#fbb86d",
  4: "#f4a8a8",
  5: "#f4577a",
};

const NEGLECT_LABEL: Record<number, string> = {
  1: "FRESH",
  2: "QUIET",
  3: "AGEING",
  4: "LONG NEGLECTED",
  5: "SEVERELY NEGLECTED",
};

const NEGLECT_BLURB: Record<number, string> = {
  1: "asked recently · still warm",
  2: "two weeks in the dark",
  3: "a month with no answer",
  4: "you haven't come back to this in months",
  5: "this question has been hanging in the air a long time",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  acknowledged: "#7affcb",
  answered: "#7affcb",
  contested: "#fbb86d",
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

export function QuestionGraveyardConsole() {
  const [rows, setRows] = useState<Question[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [answeredFilter, setAnsweredFilter] = useState<FilterAnswered>("any");
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [minNeglect, setMinNeglect] = useState<number>(1);
  const [minConfidence, setMinConfidence] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(180);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Status>("acknowledged");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("answered", answeredFilter);
      params.set("kind", kindFilter);
      params.set("domain", domainFilter);
      params.set("min_neglect", String(minNeglect));
      params.set("min_confidence", String(minConfidence));
      params.set("limit", "100");
      const r = await fetch(`/api/question-graveyard?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { questions: Question[]; stats: Stats };
      setRows(j.questions);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, answeredFilter, kindFilter, domainFilter, minNeglect, minConfidence]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/question-graveyard/scan`, {
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
      const r = await fetch(`/api/question-graveyard/${id}`, {
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
          {stats ? `${stats.total} questions · ${stats.unanswered} unanswered · ${stats.severely_neglected} severely neglected` : ""}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: "#c9b3f4", color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          Mine the graveyard
        </button>
      </div>

      {/* Headline stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <Stat label="severely neglected" value={stats.severely_neglected} colour={NEGLECT_COLOR[5] ?? "#f4577a"} big />
          <Stat label="strongly neglected" value={stats.strongly_neglected} colour={NEGLECT_COLOR[4] ?? "#f4a8a8"} big />
          <Stat label="unanswered" value={stats.unanswered} colour="#bfb5a8" />
          <Stat label="answered" value={stats.answered} colour={STATUS_COLOR.answered} />
          <Stat label="dismissed" value={stats.dismissed} colour={STATUS_COLOR.dismissed} />
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {(["pending", "acknowledged", "answered", "contested", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
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

      {/* Answered filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Answered:</span>
        {(["any", "false", "true"] as const).map((a) => {
          const active = answeredFilter === a;
          const c = a === "true" ? STATUS_COLOR.answered : a === "false" ? "#f4a8a8" : "#bfb5a8";
          const lbl = a === "any" ? "any" : a === "true" ? "answered" : "unanswered";
          return (
            <button
              key={a}
              onClick={() => setAnsweredFilter(a)}
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

      {/* Kind filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Kind:</span>
        {(["all", "decision", "self_inquiry", "meta", "factual", "hypothetical", "rhetorical"] as const).map((k) => {
          const active = kindFilter === k;
          const c = k === "all" ? "#bfb5a8" : KIND_COLOR[k as QuestionKind];
          const count = stats && k !== "all" ? stats.kind_counts[k as QuestionKind] : null;
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
              {k === "self_inquiry" ? "self-inquiry" : k}{count != null ? ` ${count}` : ""}
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

      {/* Min neglect + min confidence */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min neglect:</span>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = minNeglect === n;
            const c = NEGLECT_COLOR[n] ?? "#bfb5a8";
            return (
              <button
                key={n}
                onClick={() => setMinNeglect(n)}
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
          scan complete · {scanResult.inserted} new questions surfaced · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.question_candidates != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.question_candidates} candidate questions, {scanResult.signals.questions_extracted ?? 0} valid</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "no scan yet — run one to surface the questions you've been asking yourself" : "no questions match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((q) => {
            const nTint = NEGLECT_COLOR[q.neglect_score] ?? "#bfb5a8";
            const kTint = KIND_COLOR[q.question_kind];
            const dTint = DOMAIN_COLOR[q.domain];
            const statusColour = STATUS_COLOR[q.status];
            const isAnswered = q.answered || q.status === "answered";
            const tint = isAnswered ? STATUS_COLOR.answered : nTint;
            return (
              <div
                key={q.id}
                style={{
                  border: `1px solid ${q.pinned ? tint : "#2a2620"}`,
                  borderLeft: `3px solid ${tint}`,
                  padding: 16,
                  background: q.archived_at ? "#0f0d0a" : "#171411",
                  opacity: q.archived_at ? 0.6 : 1,
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: kTint, letterSpacing: 1.6, textTransform: "uppercase" }}>{KIND_LABEL[q.question_kind]}</span>
                    <span style={{ fontSize: 9, color: dTint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${dTint}`, padding: "1px 5px" }}>{q.domain}</span>
                    {!isAnswered && (
                      <>
                        <span style={{ fontSize: 10, fontWeight: 700, color: nTint, letterSpacing: 1.6, textTransform: "uppercase" }}>· {NEGLECT_LABEL[q.neglect_score] ?? ""}</span>
                        <span style={{ fontSize: 11, color: "#5a544c", fontStyle: "italic" }}>{NEGLECT_BLURB[q.neglect_score] ?? ""}</span>
                      </>
                    )}
                    {isAnswered && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR.answered, letterSpacing: 1.6, textTransform: "uppercase" }}>· ANSWERED</span>
                    )}
                    {dotMeter(q.confidence, "#bfb5a8")}
                    {q.status !== "pending" && q.status !== "answered" && (
                      <span style={{ fontSize: 9, color: statusColour, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${statusColour}`, padding: "1px 5px" }}>
                        {q.status}
                      </span>
                    )}
                    {q.pinned && (
                      <span style={{ fontSize: 9, color: tint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tint}`, padding: "1px 5px" }}>pinned</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#5a544c" }}>asked {q.asked_date} · {q.days_since_asked}d ago</div>
                </div>

                {/* The question itself */}
                <div style={{ marginBottom: 14, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${kTint}` }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: isAnswered ? "#bfb5a8" : "#e8e0d2", lineHeight: 1.4, fontStyle: "italic" }}>
                    &ldquo;{q.question_text}&rdquo;
                  </div>
                  {q.asked_again_count > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "#fbb86d", letterSpacing: 0.4 }}>
                      asked yourself {q.asked_again_count + 1} times · across {q.asked_again_days + 1} day{q.asked_again_days === 0 ? "" : "s"}
                    </div>
                  )}
                </div>

                {/* If the user has explicitly answered (status='answered' with note), show that */}
                {q.status === "answered" && q.status_note && (
                  <div style={{ marginBottom: 14, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.answered}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.answered, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>Your answer ({q.answer_date ?? ""})</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 15, color: "#e8e0d2", lineHeight: 1.5 }}>
                      {q.status_note}
                    </div>
                  </div>
                )}

                {/* Auto-detected answer (Phase 2 found one) */}
                {q.answered && q.status !== "answered" && q.answer_text && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#0f0d0a", borderLeft: `2px solid ${STATUS_COLOR.answered}` }}>
                    <div style={{ fontSize: 10, color: STATUS_COLOR.answered, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
                      Possible answer detected ({q.answer_date}{q.days_to_answer != null ? ` · ${q.days_to_answer}d after asking` : ""}):
                    </div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: 14, fontStyle: "italic", color: "#bfb5a8", lineHeight: 1.5 }}>
                      &ldquo;{q.answer_text}&rdquo;
                    </div>
                  </div>
                )}

                {/* Other proposed answers (beyond the canonical one) */}
                {q.proposed_answer_excerpts.length > 1 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
                      Other moments you may have answered ({q.proposed_answer_excerpts.length} total):
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {q.proposed_answer_excerpts.slice(1).map((m, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#bfb5a8", padding: "6px 10px", background: "#0f0d0a", borderLeft: `1px solid ${STATUS_COLOR.answered}33`, lineHeight: 1.45 }}>
                          <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", marginRight: 8 }}>{m.date}</span>
                          <span style={{ fontStyle: "italic" }}>{m.snippet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Aliases */}
                {q.topic_aliases.length > 0 && (
                  <div style={{ fontSize: 10, color: "#5a544c", marginBottom: 12, lineHeight: 1.5 }}>
                    matched topic: <span style={{ fontFamily: "ui-monospace, monospace", color: "#8a8378" }}>{q.topic_aliases.join(" / ")}</span>
                  </div>
                )}

                {/* Existing status note (non-answer cases) */}
                {q.status !== "answered" && q.status_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic", marginBottom: 8 }}>
                    your note: {q.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {resolveOpenId === q.id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2620" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["answered", "acknowledged", "contested", "dismissed"] as const).map((s) => {
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
                      placeholder={resolveStatus === "answered" ? "Your answer to the question (will be saved as the canonical answer)..." : "optional note..."}
                      rows={resolveStatus === "answered" ? 4 : 2}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: resolveStatus === "answered" ? "Georgia, serif" : "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          const body: Record<string, unknown> = { status: resolveStatus };
                          if (resolveNote.trim().length > 0) body.status_note = resolveNote;
                          await patch(q.id, body);
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
                    {q.status === "pending" && (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(q.id); setResolveStatus("answered"); setResolveNote(q.status_note ?? ""); }}
                          style={{ background: STATUS_COLOR.answered, color: "#1c1815", border: `1px solid ${STATUS_COLOR.answered}`, padding: "4px 12px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
                        >
                          answer this now
                        </button>
                        {(["acknowledged", "contested", "dismissed"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => { setResolveOpenId(q.id); setResolveStatus(s); setResolveNote(q.status_note ?? ""); }}
                            style={{ background: "transparent", color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                          >
                            {s}
                          </button>
                        ))}
                      </>
                    )}
                    <button
                      onClick={() => patch(q.id, { pin: !q.pinned })}
                      style={{ background: "transparent", color: q.pinned ? tint : "#8a8378", border: `1px solid ${q.pinned ? tint : "#2a2620"}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                    >
                      {q.pinned ? "unpin" : "pin"}
                    </button>
                    {q.archived_at ? (
                      <button
                        onClick={() => patch(q.id, { restore: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        restore
                      </button>
                    ) : (
                      <button
                        onClick={() => patch(q.id, { archive: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        archive
                      </button>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#5a544c" }}>{relTime(q.created_at)}</span>
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
              Mine the graveyard
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Mines your messages in the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong> for self-directed questions you asked into the void — decisions, self-inquiries, meta-questions — then walks subsequent messages looking for evidence you actually answered them. The unanswered ones live here.
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
