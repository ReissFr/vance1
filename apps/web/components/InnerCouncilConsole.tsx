"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type VoiceKey =
  | "past_self_1y"
  | "future_self_5y"
  | "values_self"
  | "ambitious_self"
  | "tired_self"
  | "wise_self";

type Voice = {
  id: string;
  voice: VoiceKey;
  content: string;
  confidence: number;
  starred: boolean;
  source_kinds: string[];
  source_count: number;
  latency_ms: number | null;
  created_at: string;
};

type Session = {
  id: string;
  question: string;
  synthesis_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const VOICE_LABEL: Record<VoiceKey, string> = {
  past_self_1y: "you · 1 year ago",
  future_self_5y: "you · 5 years ahead",
  values_self: "your values",
  ambitious_self: "your ambition",
  tired_self: "your tired self",
  wise_self: "your wisdom",
};

const VOICE_HINT: Record<VoiceKey, string> = {
  past_self_1y: "the version of you who wrote those reflections a year ago",
  future_self_5y: "an older you, looking back from 5 years ahead",
  values_self: "speaks only from your stated values + refusals",
  ambitious_self: "speaks from your open goals + active themes",
  tired_self: "speaks from your low-energy days + recurring blockers",
  wise_self: "speaks from your lessons, regrets, and realisations",
};

const VOICE_COLOR: Record<VoiceKey, string> = {
  past_self_1y: "#bfd4ee",
  future_self_5y: "#c89bff",
  values_self: "#7affcb",
  ambitious_self: "#fbb86d",
  tired_self: "#9aa28e",
  wise_self: "#e8e0d2",
};

const ALL_VOICES: VoiceKey[] = [
  "past_self_1y",
  "future_self_5y",
  "values_self",
  "ambitious_self",
  "tired_self",
  "wise_self",
];

type StatusFilter = "active" | "pinned" | "archived" | "all";

export function InnerCouncilConsole() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeVoices, setActiveVoices] = useState<Voice[]>([]);
  const [question, setQuestion] = useState("");
  const [voiceSelection, setVoiceSelection] = useState<Set<VoiceKey>>(new Set(ALL_VOICES));
  const [convening, setConvening] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingActive, setLoadingActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const loadSessions = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const r = await fetch(`/api/inner-council?status=${statusFilter}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setSessions((j.sessions ?? []) as Session[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const loadActive = useCallback(async (id: string) => {
    setLoadingActive(true);
    setError(null);
    try {
      const r = await fetch(`/api/inner-council/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setActiveSession(j.session as Session);
      setActiveVoices(((j.voices ?? []) as Voice[]).slice().sort((a, b) => a.voice.localeCompare(b.voice)));
      setNoteDraft((j.session as Session).synthesis_note ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoadingActive(false);
    }
  }, []);

  useEffect(() => { if (activeId) void loadActive(activeId); }, [activeId, loadActive]);

  const toggleVoice = useCallback((v: VoiceKey) => {
    setVoiceSelection((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      if (next.size === 0) next.add(v);
      return next;
    });
  }, []);

  const convene = useCallback(async () => {
    const q = question.trim();
    if (q.length < 4) {
      setError("Type a question first.");
      return;
    }
    setConvening(true);
    setError(null);
    try {
      const r = await fetch("/api/inner-council", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, voices: Array.from(voiceSelection) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "convene failed");
      setQuestion("");
      await loadSessions();
      if (j?.session?.id) setActiveId(j.session.id as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "convene failed");
    } finally {
      setConvening(false);
    }
  }, [question, voiceSelection, loadSessions]);

  const onStar = useCallback(async (vid: string, starred: boolean) => {
    setActiveVoices((prev) => prev.map((v) => (v.id === vid ? { ...v, starred } : v)));
    try {
      await fetch(`/api/inner-council/voice/${vid}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ star: starred }),
      });
    } catch { /* noop, optimistic */ }
  }, []);

  const onPin = useCallback(async (id: string, pin: boolean) => {
    try {
      await fetch(`/api/inner-council/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      void loadSessions();
      if (activeId === id) await loadActive(id);
    } catch { /* noop */ }
  }, [loadSessions, loadActive, activeId]);

  const onArchive = useCallback(async (id: string) => {
    try {
      await fetch(`/api/inner-council/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
      if (activeId === id) {
        setActiveId(null);
        setActiveSession(null);
        setActiveVoices([]);
      }
      void loadSessions();
    } catch { /* noop */ }
  }, [loadSessions, activeId]);

  const onDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/inner-council/${id}`, { method: "DELETE" });
      if (activeId === id) {
        setActiveId(null);
        setActiveSession(null);
        setActiveVoices([]);
      }
      void loadSessions();
    } catch { /* noop */ }
  }, [loadSessions, activeId]);

  const onSaveNote = useCallback(async () => {
    if (!activeSession) return;
    try {
      await fetch(`/api/inner-council/${activeSession.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ synthesis_note: noteDraft }),
      });
      setEditingNote(false);
      void loadActive(activeSession.id);
    } catch { /* noop */ }
  }, [activeSession, noteDraft, loadActive]);

  const sortedSessions = useMemo(
    () => sessions.slice().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updated_at.localeCompare(a.updated_at);
    }),
    [sessions],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
          Convene the council
        </span>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, border: "1px solid #2a2a2a", background: "#1a1a1a" }}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="ask the room one thing · 'should I keep building this' / 'how do I stop dropping the ball on X' / 'what am I avoiding right now'"
            style={{
              minHeight: 78,
              padding: 10,
              background: "#0e0e0e",
              color: "#e8e0d2",
              border: "1px solid #2a2a2a",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
              lineHeight: 1.5,
            }}
            disabled={convening}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void convene(); }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, letterSpacing: 0.5, color: "#888", textTransform: "uppercase" }}>voices</span>
            {ALL_VOICES.map((v) => {
              const on = voiceSelection.has(v);
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleVoice(v)}
                  title={VOICE_HINT[v]}
                  style={{
                    padding: "3px 9px",
                    background: on ? VOICE_COLOR[v] : "transparent",
                    color: on ? "#111" : VOICE_COLOR[v],
                    border: `1px solid ${VOICE_COLOR[v]}`,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {VOICE_LABEL[v]}
                </button>
              );
            })}
            <span style={{ flex: 1 }} />
            <span style={{ color: "#666", fontSize: 11 }}>⌘↵</span>
            <button
              type="button"
              disabled={convening || question.trim().length < 4}
              onClick={convene}
              style={{
                padding: "5px 16px",
                background: convening ? "#444" : "#e8e0d2",
                color: convening ? "#888" : "#111",
                border: "1px solid #e8e0d2",
                fontSize: 12,
                cursor: convening ? "wait" : "pointer",
              }}
            >
              {convening ? "convening…" : "Convene"}
            </button>
          </div>
        </div>
        {error ? <div style={{ color: "#f4a3a3", fontSize: 13 }}>{error}</div> : null}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18 }}>
        <aside style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["active", "pinned", "archived", "all"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: "2px 8px",
                  background: statusFilter === s ? "#e8e0d2" : "transparent",
                  color: statusFilter === s ? "#111" : "#aaa",
                  border: "1px solid " + (statusFilter === s ? "#e8e0d2" : "#333"),
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 600, overflowY: "auto" }}>
            {loadingList ? <div style={{ color: "#666", fontSize: 12 }}>loading…</div> : null}
            {!loadingList && sortedSessions.length === 0 ? (
              <div style={{ color: "#666", fontSize: 12, fontStyle: "italic" }}>no sessions yet</div>
            ) : null}
            {sortedSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  background: activeId === s.id ? "#1f1f1f" : "transparent",
                  border: "1px solid " + (activeId === s.id ? "#3a3a3a" : "#1d1d1d"),
                  borderLeft: `3px solid ${s.pinned ? "#ffd76b" : "#2a2a2a"}`,
                  color: "#e8e0d2",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ fontSize: 12, lineHeight: 1.35, color: "#e8e0d2" }}>
                  {s.question.length > 90 ? `${s.question.slice(0, 90)}…` : s.question}
                </div>
                <div style={{ fontSize: 10, color: "#666" }}>
                  {s.updated_at.slice(0, 10)}
                  {s.pinned ? " · pinned" : ""}
                  {s.archived_at ? " · archived" : ""}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!activeSession ? (
            <div
              style={{
                padding: 24,
                border: "1px dashed #2a2a2a",
                color: "#9aa28e",
                fontFamily: "var(--font-serif, Georgia, serif)",
                fontStyle: "italic",
                fontSize: 16,
              }}
            >
              Ask something. The voices will speak in parallel and you'll see all six side by side, drawn from different slices of your own writing.
            </div>
          ) : (
            <>
              <header style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: "1px solid #232323" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, letterSpacing: 1, color: "#666", textTransform: "uppercase" }}>question</span>
                  <span style={{ fontSize: 11, color: "#444" }}>· {activeSession.created_at.slice(0, 10)}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => onPin(activeSession.id, !activeSession.pinned)}
                    style={{ background: "transparent", border: "1px solid #333", color: activeSession.pinned ? "#ffd76b" : "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
                  >
                    {activeSession.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onArchive(activeSession.id)}
                    style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(activeSession.id)}
                    style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
                  >
                    Delete
                  </button>
                </div>
                <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", color: "#e8e0d2", fontSize: 18, lineHeight: 1.45 }}>
                  {activeSession.question}
                </div>
              </header>

              {loadingActive ? <div style={{ color: "#666", fontSize: 12 }}>loading…</div> : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12 }}>
                {activeVoices.map((v) => {
                  const color = VOICE_COLOR[v.voice];
                  return (
                    <article
                      key={v.id}
                      style={{
                        padding: 14,
                        background: "#161616",
                        borderTop: `3px solid ${color}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        position: "relative",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, letterSpacing: 1, color, textTransform: "uppercase" }}>
                          {VOICE_LABEL[v.voice]}
                        </span>
                        <span style={{ fontSize: 10, color: "#666" }}>· conf {v.confidence}/5</span>
                        <span style={{ fontSize: 10, color: "#444" }}>· {v.source_count} source rows</span>
                        <span style={{ flex: 1 }} />
                        <button
                          type="button"
                          onClick={() => onStar(v.id, !v.starred)}
                          style={{ background: "transparent", border: "1px solid #333", color: v.starred ? "#ffd76b" : "#666", fontSize: 13, padding: "1px 7px", cursor: "pointer" }}
                          title={v.starred ? "unstar" : "star"}
                        >
                          {v.starred ? "★" : "☆"}
                        </button>
                      </div>
                      <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#e8e0d2", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                        {v.content}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingTop: 6, borderTop: "1px solid #222" }}>
                        <span style={{ fontSize: 9, letterSpacing: 1, color: "#555", textTransform: "uppercase" }}>grounded in</span>
                        {v.source_kinds.length === 0 ? <span style={{ fontSize: 10, color: "#444" }}>·  thin record</span> : null}
                        {v.source_kinds.map((k) => (
                          <span key={k} style={{ fontSize: 10, color: "#888", border: "1px solid #2a2a2a", padding: "0 5px" }}>{k}</span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>

              <section style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid #232323" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 11, letterSpacing: 1, color: "#888", textTransform: "uppercase" }}>your synthesis</span>
                  <span style={{ flex: 1 }} />
                  {!editingNote ? (
                    <button
                      type="button"
                      onClick={() => setEditingNote(true)}
                      style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
                    >
                      {activeSession.synthesis_note ? "Edit" : "Write your own answer"}
                    </button>
                  ) : null}
                </div>
                {editingNote ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="having heard them all · what do you actually think"
                      style={{
                        minHeight: 100,
                        padding: 10,
                        background: "#0e0e0e",
                        color: "#e8e0d2",
                        border: "1px solid #2a2a2a",
                        fontSize: 14,
                        fontFamily: "var(--font-serif, Georgia, serif)",
                        resize: "vertical",
                        lineHeight: 1.5,
                      }}
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={onSaveNote}
                        style={{ padding: "4px 12px", background: "#e8e0d2", color: "#111", border: "1px solid #e8e0d2", fontSize: 11, cursor: "pointer" }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingNote(false); setNoteDraft(activeSession.synthesis_note ?? ""); }}
                        style={{ padding: "4px 12px", background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : activeSession.synthesis_note ? (
                  <div
                    style={{
                      padding: 12,
                      background: "#0e0e0e",
                      borderLeft: "3px solid #e8e0d2",
                      fontFamily: "var(--font-serif, Georgia, serif)",
                      fontStyle: "italic",
                      color: "#e8e0d2",
                      fontSize: 14,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {activeSession.synthesis_note}
                  </div>
                ) : (
                  <div style={{ color: "#666", fontSize: 12, fontStyle: "italic" }}>
                    no synthesis yet · the council has spoken, you have the last word
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
