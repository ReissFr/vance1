"use client";

import { useCallback, useEffect, useState } from "react";

type VoiceType =
  | "parent" | "partner" | "inner_critic" | "social_norm"
  | "professional_norm" | "financial_judge" | "past_self"
  | "future_self" | "mentor" | "abstract_other";

type Stance = "push" | "pull" | "protect" | "caution" | "ambivalent";

type PanelEntry = {
  voice_id: string;
  voice_name: string;
  voice_type: VoiceType;
  voice_relation: string | null;
  severity: number;
  airtime: number;
  stance: Stance;
  reply: string;
  reasoning: string;
};

type Outcome = "unresolved" | "went_with_voice" | "self_authored" | "silenced_voice";
type FilterOutcome = Outcome | "all";

type Session = {
  id: string;
  question: string;
  context_note: string | null;
  panel: PanelEntry[];
  voices_consulted: number;
  dominant_stance: Stance | null;
  outcome: Outcome;
  chosen_voice_id: string | null;
  silenced_voice_id: string | null;
  self_authored_answer: string | null;
  decision_note: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  resolved_at: string | null;
  archived_at: string | null;
};

type Stats = {
  total: number;
  unresolved: number;
  went_with_voice: number;
  self_authored: number;
  silenced_voice: number;
  total_voices_consulted: number;
  top_chosen: { voice_id: string; count: number }[];
  top_silenced: { voice_id: string; count: number }[];
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

const STANCE_LABEL: Record<Stance, string> = {
  push: "PUSH",
  pull: "PULL",
  protect: "PROTECT",
  caution: "CAUTION",
  ambivalent: "AMBIVALENT",
};

const STANCE_COLOR: Record<Stance, string> = {
  push: "#fbb86d",
  pull: "#f4577a",
  protect: "#f4a8a8",
  caution: "#ffd966",
  ambivalent: "#9aa28e",
};

const STANCE_BLURB: Record<Stance, string> = {
  push: "wants you to do it",
  pull: "wants you not to",
  protect: "warning against a downside",
  caution: "sees both sides",
  ambivalent: "no strong take on this one",
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  unresolved: "UNRESOLVED",
  went_with_voice: "WENT WITH A VOICE",
  self_authored: "SELF AUTHORED",
  silenced_voice: "SILENCED A VOICE",
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  unresolved: "#bfb5a8",
  went_with_voice: "#bfd4ee",
  self_authored: "#7affcb",
  silenced_voice: "#c9b3f4",
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
        <span key={i} style={{ width: 6, height: 6, borderRadius: 6, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function TheatreConsole() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<FilterOutcome>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [convening, setConvening] = useState(false);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<Outcome>("self_authored");
  const [resolveChosenId, setResolveChosenId] = useState<string>("");
  const [resolveSilencedId, setResolveSilencedId] = useState<string>("");
  const [resolveAnswer, setResolveAnswer] = useState("");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (outcomeFilter !== "all") params.set("outcome", outcomeFilter);
      params.set("limit", "60");
      const r = await fetch(`/api/mind-theatre?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { sessions: Session[]; stats: Stats };
      setSessions(j.sessions);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [outcomeFilter]);

  useEffect(() => { void load(); }, [load]);

  const convene = async () => {
    if (question.trim().length < 4) {
      setError("name what you are sitting with (4+ chars)");
      return;
    }
    setConvening(true);
    setError(null);
    try {
      const r = await fetch(`/api/mind-theatre/convene`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          context_note: contextNote.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      setQuestion("");
      setContextNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConvening(false);
    }
  };

  const openResolve = (s: Session, mode: Outcome) => {
    setResolveOpenId(s.id);
    setResolveMode(mode);
    setResolveChosenId("");
    setResolveSilencedId("");
    setResolveAnswer("");
    setResolveNote("");
  };

  const submitResolve = async (s: Session) => {
    setError(null);
    try {
      let body: Record<string, unknown> = { mode: resolveMode };
      if (resolveMode === "went_with_voice") {
        if (!resolveChosenId) { setError("pick which voice you went with"); return; }
        body = { mode: resolveMode, chosen_voice_id: resolveChosenId, decision_note: resolveNote.trim() || undefined };
      } else if (resolveMode === "silenced_voice") {
        if (!resolveSilencedId) { setError("pick which voice you are silencing"); return; }
        if (resolveNote.trim().length < 4) { setError("write why this voice does not get a vote on this question (4+ chars)"); return; }
        body = { mode: resolveMode, silenced_voice_id: resolveSilencedId, decision_note: resolveNote.trim() };
      } else if (resolveMode === "self_authored") {
        if (resolveAnswer.trim().length < 4) { setError("write your own answer (4+ chars)"); return; }
        body = { mode: resolveMode, self_authored_answer: resolveAnswer.trim(), decision_note: resolveNote.trim() || undefined };
      }
      const r = await fetch(`/api/mind-theatre/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      setResolveOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reopenSession = async (s: Session) => {
    setError(null);
    try {
      const r = await fetch(`/api/mind-theatre/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "unresolved" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const archiveSession = async (s: Session) => {
    setError(null);
    try {
      const r = await fetch(`/api/mind-theatre/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "archive" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
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
          {stats ? `${stats.total} sessions · ${stats.unresolved} unresolved · ${stats.self_authored} self authored · ${stats.silenced_voice} voices silenced` : ""}
        </div>
      </div>

      {/* Convene the panel */}
      <div style={{
        background: "#1a1612",
        border: "1px solid #2a2620",
        borderLeft: "3px solid #7affcb",
        padding: "20px 22px",
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 11, color: "#7affcb", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 10 }}>
          Convene the panel
        </div>
        <div style={{ fontSize: 13, color: "#bfb5a8", marginBottom: 16, fontStyle: "italic" }}>
          name the question you are sitting with. each voice in your cabinet replies in character.
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. should i take the meeting on saturday morning instead of resting?"
          rows={3}
          style={{
            width: "100%",
            background: "#0f0d0a",
            border: "1px solid #2a2620",
            color: "#e8e0d2",
            padding: "12px 14px",
            fontSize: 16,
            fontFamily: "Georgia, ui-serif, serif",
            fontStyle: "italic",
            resize: "vertical",
            marginBottom: 12,
          }}
        />
        <textarea
          value={contextNote}
          onChange={(e) => setContextNote(e.target.value)}
          placeholder="optional · context for the panel"
          rows={2}
          style={{
            width: "100%",
            background: "#0f0d0a",
            border: "1px solid #2a2620",
            color: "#bfb5a8",
            padding: "10px 12px",
            fontSize: 13,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            resize: "vertical",
            marginBottom: 12,
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={convene}
            disabled={convening}
            style={{
              background: convening ? "#2a2620" : "#7affcb",
              color: convening ? "#8a8378" : "#0f0d0a",
              border: "none",
              padding: "10px 22px",
              fontSize: 11,
              letterSpacing: 1.6,
              textTransform: "uppercase",
              fontWeight: 600,
              cursor: convening ? "default" : "pointer",
            }}
          >
            {convening ? "Convening..." : "Convene panel"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Outcome:</span>
        {(["all", "unresolved", "went_with_voice", "self_authored", "silenced_voice"] as FilterOutcome[]).map((o) => (
          <button
            key={o}
            onClick={() => setOutcomeFilter(o)}
            style={{
              background: outcomeFilter === o ? "#2a2620" : "transparent",
              border: `1px solid ${outcomeFilter === o ? "#5a5248" : "#2a2620"}`,
              color: outcomeFilter === o ? "#e8e0d2" : "#8a8378",
              padding: "5px 11px",
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {o === "all" ? "All" : OUTCOME_LABEL[o as Outcome]}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: "12px 14px", background: "#2a1a1a", border: "1px solid #5a3232", color: "#f4a8a8", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0" }}>Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "32px 0", fontStyle: "italic" }}>
          No sessions yet. Name a question above and convene the panel.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {sessions.map((s) => {
            const stanceColor = s.dominant_stance ? STANCE_COLOR[s.dominant_stance] : "#bfb5a8";
            const outcomeColor = OUTCOME_COLOR[s.outcome];
            const leftBorder = s.outcome === "unresolved" ? stanceColor : outcomeColor;
            const isResolveOpen = resolveOpenId === s.id;

            return (
              <div key={s.id} style={{
                background: "#1a1612",
                border: "1px solid #2a2620",
                borderLeft: `3px solid ${leftBorder}`,
                padding: "18px 20px",
              }}>
                {/* Question header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 22,
                      color: "#e8e0d2",
                      lineHeight: 1.3,
                      fontStyle: "italic",
                    }}>
                      {s.question}
                    </div>
                    {s.context_note && (
                      <div style={{ fontSize: 12, color: "#8a8378", marginTop: 6, fontStyle: "italic" }}>
                        context · {s.context_note}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 9,
                      color: outcomeColor,
                      letterSpacing: 1.4,
                      textTransform: "uppercase",
                      border: `1px solid ${outcomeColor}`,
                      padding: "3px 8px",
                    }}>
                      {OUTCOME_LABEL[s.outcome]}
                    </span>
                    <span style={{ fontSize: 10, color: "#5a5248" }}>
                      {relTime(s.created_at)} · {s.voices_consulted} voices
                    </span>
                  </div>
                </div>

                {/* Panel */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                  {s.panel.map((p) => {
                    const stColor = STANCE_COLOR[p.stance];
                    const tyColor = TYPE_COLOR[p.voice_type] ?? "#9aa28e";
                    const isChosen = s.chosen_voice_id === p.voice_id;
                    const isSilenced = s.silenced_voice_id === p.voice_id;
                    const tint = isChosen ? "#7affcb" : isSilenced ? "#c9b3f4" : stColor;
                    return (
                      <div key={p.voice_id} style={{
                        background: "#0f0d0a",
                        border: "1px solid #2a2620",
                        borderLeft: `2px solid ${tint}`,
                        padding: "12px 14px",
                        opacity: isSilenced ? 0.55 : 1,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
                          <div>
                            <span style={{
                              fontFamily: "Georgia, ui-serif, serif",
                              fontSize: 17,
                              color: "#e8e0d2",
                              fontStyle: "italic",
                            }}>
                              {p.voice_name}
                            </span>
                            <span style={{ fontSize: 9, color: tyColor, letterSpacing: 1.4, textTransform: "uppercase", marginLeft: 12 }}>
                              {TYPE_LABEL[p.voice_type] ?? p.voice_type.toUpperCase()}
                            </span>
                            {isChosen && (
                              <span style={{ fontSize: 9, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase", marginLeft: 10, border: "1px solid #7affcb", padding: "2px 6px" }}>
                                You went with this
                              </span>
                            )}
                            {isSilenced && (
                              <span style={{ fontSize: 9, color: "#c9b3f4", letterSpacing: 1.4, textTransform: "uppercase", marginLeft: 10, border: "1px solid #c9b3f4", padding: "2px 6px" }}>
                                Silenced
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 9, color: stColor, letterSpacing: 1.4, textTransform: "uppercase", border: `1px solid ${stColor}`, padding: "2px 7px" }}>
                              {STANCE_LABEL[p.stance]}
                            </span>
                            {dotMeter(p.severity, stColor)}
                          </div>
                        </div>
                        <div style={{
                          fontFamily: "Georgia, ui-serif, serif",
                          fontSize: 16,
                          color: "#e8e0d2",
                          lineHeight: 1.5,
                          marginTop: 10,
                          fontStyle: "italic",
                        }}>
                          &ldquo;{p.reply}&rdquo;
                        </div>
                        <div style={{ fontSize: 11, color: "#8a8378", marginTop: 8, fontStyle: "italic" }}>
                          {STANCE_BLURB[p.stance]} · {p.reasoning}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Resolved panel */}
                {s.outcome === "self_authored" && s.self_authored_answer && (
                  <div style={{
                    marginTop: 14,
                    background: "#0f0d0a",
                    border: "1px solid #2a2620",
                    borderLeft: "2px solid #7affcb",
                    padding: "12px 14px",
                  }}>
                    <div style={{ fontSize: 10, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>
                      Self authored · what you chose yourself
                    </div>
                    <div style={{
                      fontFamily: "Georgia, ui-serif, serif",
                      fontSize: 16,
                      color: "#e8e0d2",
                      lineHeight: 1.5,
                    }}>
                      {s.self_authored_answer}
                    </div>
                  </div>
                )}

                {s.decision_note && s.outcome !== "unresolved" && (
                  <div style={{
                    marginTop: 10,
                    fontSize: 13,
                    color: "#bfb5a8",
                    fontStyle: "italic",
                    paddingLeft: 12,
                    borderLeft: "1px solid #2a2620",
                  }}>
                    note · {s.decision_note}
                  </div>
                )}

                {/* Actions */}
                {s.outcome === "unresolved" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                    {!isResolveOpen && (
                      <>
                        <button
                          onClick={() => openResolve(s, "self_authored")}
                          style={{
                            background: "#7affcb",
                            color: "#0f0d0a",
                            border: "none",
                            padding: "8px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Override · write your own
                        </button>
                        <button
                          onClick={() => openResolve(s, "went_with_voice")}
                          style={{
                            background: "transparent",
                            color: "#bfd4ee",
                            border: "1px solid #bfd4ee",
                            padding: "8px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          I went with a voice
                        </button>
                        <button
                          onClick={() => openResolve(s, "silenced_voice")}
                          style={{
                            background: "transparent",
                            color: "#c9b3f4",
                            border: "1px solid #c9b3f4",
                            padding: "8px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          Silence a voice on this
                        </button>
                        <button
                          onClick={() => archiveSession(s)}
                          style={{
                            background: "transparent",
                            color: "#8a8378",
                            border: "1px solid #2a2620",
                            padding: "8px 14px",
                            fontSize: 10,
                            letterSpacing: 1.4,
                            textTransform: "uppercase",
                            cursor: "pointer",
                            marginLeft: "auto",
                          }}
                        >
                          Archive
                        </button>
                      </>
                    )}
                    {isResolveOpen && (
                      <div style={{ width: "100%", background: "#0f0d0a", border: "1px solid #2a2620", padding: "14px 16px" }}>
                        <div style={{ fontSize: 10, color: OUTCOME_COLOR[resolveMode], letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 10 }}>
                          {OUTCOME_LABEL[resolveMode]}
                        </div>
                        {resolveMode === "went_with_voice" && (
                          <select
                            value={resolveChosenId}
                            onChange={(e) => setResolveChosenId(e.target.value)}
                            style={{
                              width: "100%",
                              background: "#1a1612",
                              border: "1px solid #2a2620",
                              color: "#e8e0d2",
                              padding: "10px 12px",
                              fontSize: 13,
                              marginBottom: 10,
                            }}
                          >
                            <option value="">Pick which voice you went with...</option>
                            {s.panel.map((p) => (
                              <option key={p.voice_id} value={p.voice_id}>{p.voice_name} ({STANCE_LABEL[p.stance]})</option>
                            ))}
                          </select>
                        )}
                        {resolveMode === "silenced_voice" && (
                          <select
                            value={resolveSilencedId}
                            onChange={(e) => setResolveSilencedId(e.target.value)}
                            style={{
                              width: "100%",
                              background: "#1a1612",
                              border: "1px solid #2a2620",
                              color: "#e8e0d2",
                              padding: "10px 12px",
                              fontSize: 13,
                              marginBottom: 10,
                            }}
                          >
                            <option value="">Pick which voice does not get a vote...</option>
                            {s.panel.map((p) => (
                              <option key={p.voice_id} value={p.voice_id}>{p.voice_name} ({STANCE_LABEL[p.stance]})</option>
                            ))}
                          </select>
                        )}
                        {resolveMode === "self_authored" && (
                          <textarea
                            value={resolveAnswer}
                            onChange={(e) => setResolveAnswer(e.target.value)}
                            placeholder="what are you choosing yourself · in your own words"
                            rows={3}
                            style={{
                              width: "100%",
                              background: "#1a1612",
                              border: "1px solid #2a2620",
                              color: "#e8e0d2",
                              padding: "10px 12px",
                              fontSize: 14,
                              fontFamily: "Georgia, ui-serif, serif",
                              fontStyle: "italic",
                              resize: "vertical",
                              marginBottom: 10,
                            }}
                          />
                        )}
                        <textarea
                          value={resolveNote}
                          onChange={(e) => setResolveNote(e.target.value)}
                          placeholder={
                            resolveMode === "silenced_voice"
                              ? "REQUIRED · why this voice does not get a vote on this specific question"
                              : resolveMode === "went_with_voice"
                                ? "optional · why you went with this voice"
                                : "optional · note about this choice"
                          }
                          rows={2}
                          style={{
                            width: "100%",
                            background: "#1a1612",
                            border: "1px solid #2a2620",
                            color: "#bfb5a8",
                            padding: "10px 12px",
                            fontSize: 13,
                            resize: "vertical",
                            marginBottom: 12,
                          }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => submitResolve(s)}
                            style={{
                              background: OUTCOME_COLOR[resolveMode],
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
                            onClick={() => setResolveOpenId(null)}
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
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                    <button
                      onClick={() => reopenSession(s)}
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
                    <button
                      onClick={() => archiveSession(s)}
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
                      Archive
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
