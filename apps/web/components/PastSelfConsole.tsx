"use client";

import { useCallback, useEffect, useState } from "react";

type HorizonLabel = "3_months_ago" | "6_months_ago" | "1_year_ago" | "2_years_ago" | "3_years_ago" | "custom";

type DialogueListItem = {
  id: string;
  anchor_date: string;
  horizon_label: HorizonLabel;
  title: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  role: "user" | "past_self";
  content: string;
  created_at: string;
};

type ReflectionRow = { text: string; kind: string | null; created_at: string };
type DecisionRow = { title: string; choice: string | null; expected_outcome: string | null; created_at: string };
type WinRow = { text: string; kind: string | null; created_at: string };
type IntentionRow = { text: string; log_date: string; completed_at: string | null };
type CheckinRow = { log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null };
type StandupRow = { log_date: string; yesterday: string | null; today: string | null; blockers: string | null };

type PersonaSnapshot = {
  anchor_date: string;
  horizon_label: HorizonLabel;
  reflections: ReflectionRow[];
  decisions: DecisionRow[];
  wins: WinRow[];
  intentions: IntentionRow[];
  checkins: CheckinRow[];
  standups: StandupRow[];
};

type DialogueDetail = {
  id: string;
  anchor_date: string;
  horizon_label: HorizonLabel;
  persona_snapshot: PersonaSnapshot;
  title: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const HORIZON_OPTIONS: HorizonLabel[] = ["3_months_ago", "6_months_ago", "1_year_ago", "2_years_ago", "3_years_ago"];

const HORIZON_LABEL: Record<HorizonLabel, string> = {
  "3_months_ago": "3 months ago",
  "6_months_ago": "6 months ago",
  "1_year_ago": "1 year ago",
  "2_years_ago": "2 years ago",
  "3_years_ago": "3 years ago",
  "custom": "custom",
};

const HORIZON_COLOR: Record<HorizonLabel, string> = {
  "3_months_ago": "#e8e0d2",
  "6_months_ago": "#bfd4ee",
  "1_year_ago": "#7affcb",
  "2_years_ago": "#e8b96a",
  "3_years_ago": "#c89bff",
  "custom": "#9aa28e",
};

export function PastSelfConsole() {
  const [dialogues, setDialogues] = useState<DialogueListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<DialogueDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [newHorizon, setNewHorizon] = useState<HorizonLabel>("1_year_ago");
  const [customDate, setCustomDate] = useState<string>("");
  const [newOpening, setNewOpening] = useState("");
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/past-self?status=active`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      const list = (j.dialogues ?? []) as DialogueListItem[];
      setDialogues(list);
      if (!activeId && list.length > 0 && list[0]) {
        setActiveId(list[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  const loadDetail = useCallback(async (id: string) => {
    setError(null);
    try {
      const r = await fetch(`/api/past-self/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "detail failed");
      setActiveDetail(j.dialogue as DialogueDetail);
      setMessages((j.messages ?? []) as Message[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "detail failed");
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    if (activeId) void loadDetail(activeId);
    else { setActiveDetail(null); setMessages([]); }
  }, [activeId, loadDetail]);

  const startDialogue = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        horizon_label: newHorizon,
        opening_question: newOpening.trim() || undefined,
      };
      if (newHorizon === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
        payload.anchor_date = customDate;
      }
      const r = await fetch(`/api/past-self`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "start failed");
      const dialogue = j.dialogue as DialogueDetail;
      setNewOpening("");
      await loadList();
      setActiveId(dialogue.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "start failed");
    } finally {
      setCreating(false);
    }
  }, [newHorizon, customDate, newOpening, loadList]);

  const sendMessage = useCallback(async () => {
    if (!activeId) return;
    const text = draftMessage.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    setDraftMessage("");
    setMessages((prev) => [...prev, { id: `temp-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() }]);
    try {
      const r = await fetch(`/api/past-self/${activeId}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "send failed");
      const inserted = (j.messages ?? []) as Message[];
      setMessages((prev) => [...prev.filter((m) => !m.id.startsWith("temp-")), ...inserted]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
      setMessages((prev) => prev.filter((m) => !m.id.startsWith("temp-")));
      setDraftMessage(text);
    } finally {
      setSending(false);
    }
  }, [activeId, draftMessage]);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setDialogues((prev) => prev.map((d) => (d.id === id ? { ...d, pinned } : d)));
    try {
      await fetch(`/api/past-self/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: pinned }) });
      void loadList();
    } catch { void loadList(); }
  }, [loadList]);

  const archive = useCallback(async (id: string) => {
    try {
      await fetch(`/api/past-self/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archive: true }) });
      if (id === activeId) setActiveId(null);
      void loadList();
    } catch { void loadList(); }
  }, [activeId, loadList]);

  const onDelete = useCallback(async (id: string) => {
    setDialogues((prev) => prev.filter((d) => d.id !== id));
    if (id === activeId) setActiveId(null);
    try { await fetch(`/api/past-self/${id}`, { method: "DELETE" }); }
    catch { void loadList(); }
  }, [activeId, loadList]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            Talk to past you
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${dialogues.length} dialogue${dialogues.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid #2a2a2a", background: "#1a1a1a" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>start a new dialogue with</span>
            {(["3_months_ago", "6_months_ago", "1_year_ago", "2_years_ago", "3_years_ago", "custom"] as const).map((h) => {
              const active = newHorizon === h;
              const c = HORIZON_COLOR[h];
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setNewHorizon(h)}
                  style={{
                    padding: "4px 12px",
                    background: active ? c : "transparent",
                    color: active ? "#111" : c,
                    border: `1px solid ${c}`,
                    fontSize: 12,
                    cursor: "pointer",
                    letterSpacing: 0.3,
                  }}
                >
                  {HORIZON_LABEL[h]}
                </button>
              );
            })}
          </div>
          {newHorizon === "custom" ? (
            <input
              type="date"
              value={customDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setCustomDate(e.target.value)}
              style={{ padding: 6, background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 12, width: 160 }}
            />
          ) : null}
          <textarea
            value={newOpening}
            onChange={(e) => setNewOpening(e.target.value)}
            placeholder="opening question (optional) — e.g. 'how were you feeling about the work?' or 'what did you think the next year would look like?'"
            style={{ minHeight: 60, padding: 8, background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 13, fontFamily: "var(--font-serif, Georgia, serif)", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              disabled={creating || (newHorizon === "custom" && !/^\d{4}-\d{2}-\d{2}$/.test(customDate))}
              onClick={startDialogue}
              style={{
                padding: "5px 14px",
                background: creating ? "#444" : "#e8e0d2",
                color: creating ? "#888" : "#111",
                border: "1px solid #e8e0d2",
                fontSize: 12,
                cursor: creating ? "not-allowed" : "pointer",
              }}
            >
              {creating ? "summoning…" : "Begin dialogue"}
            </button>
          </div>
        </div>
      </header>

      {error ? <div style={{ color: "#f4a3a3" }}>{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)", gap: 14 }}>
        <aside style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "#888", letterSpacing: 0.5, textTransform: "uppercase" }}>dialogues</div>
          {dialogues.length === 0 ? (
            <div style={{ fontSize: 12, color: "#666", fontStyle: "italic", padding: 12, border: "1px dashed #2a2a2a" }}>
              no dialogues yet
            </div>
          ) : null}
          {dialogues.map((d) => {
            const active = d.id === activeId;
            const c = HORIZON_COLOR[d.horizon_label];
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setActiveId(d.id)}
                style={{
                  textAlign: "left",
                  padding: 10,
                  background: active ? "#161616" : "#0e0e0e",
                  border: `1px solid ${active ? c : "#1a1a1a"}`,
                  borderLeft: `3px solid ${c}`,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 10, color: c, letterSpacing: 0.5 }}>
                  {d.horizon_label === "custom" ? `ANCHOR ${d.anchor_date}` : HORIZON_LABEL[d.horizon_label].toUpperCase()}
                </span>
                <span style={{ fontSize: 13, color: "#d8d0c2", fontFamily: "var(--font-serif, Georgia, serif)" }}>
                  {d.title ?? "(untitled — start with a question)"}
                </span>
                <span style={{ fontSize: 10, color: "#666" }}>{d.updated_at.slice(0, 10)}{d.pinned ? " · pinned" : ""}</span>
              </button>
            );
          })}
        </aside>

        <section style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 400 }}>
          {!activeId ? (
            <div style={{ padding: 24, border: "1px dashed #2a2a2a", color: "#9aa28e", fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 16 }}>
              Pick a dialogue from the left, or begin a new one above.
            </div>
          ) : null}

          {activeDetail ? (
            <DetailHeader
              detail={activeDetail}
              onTogglePin={() => togglePin(activeDetail.id, !activeDetail.pinned)}
              onArchive={() => archive(activeDetail.id)}
              onDelete={() => onDelete(activeDetail.id)}
            />
          ) : null}

          {activeDetail ? (
            <PersonaCard snapshot={activeDetail.persona_snapshot} accent={HORIZON_COLOR[activeDetail.horizon_label]} />
          ) : null}

          {activeId ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  accent={activeDetail ? HORIZON_COLOR[activeDetail.horizon_label] : "#9aa28e"}
                  anchorLabel={activeDetail ? (activeDetail.horizon_label === "custom" ? `you on ${activeDetail.anchor_date}` : `you · ${HORIZON_LABEL[activeDetail.horizon_label]}`) : "past you"}
                />
              ))}
              {sending ? (
                <div style={{ fontSize: 12, color: "#666", fontStyle: "italic", padding: 8 }}>
                  …remembering from {activeDetail?.anchor_date ?? "back then"}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeId ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="ask past you anything · ⌘↵ to send"
                style={{ flex: 1, minHeight: 64, padding: 10, background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 13, fontFamily: "var(--font-serif, Georgia, serif)", resize: "vertical" }}
              />
              <button
                type="button"
                disabled={sending || !draftMessage.trim()}
                onClick={sendMessage}
                style={{
                  padding: "8px 16px",
                  background: sending || !draftMessage.trim() ? "#444" : "#e8e0d2",
                  color: sending || !draftMessage.trim() ? "#888" : "#111",
                  border: "1px solid #e8e0d2",
                  fontSize: 12,
                  cursor: sending || !draftMessage.trim() ? "not-allowed" : "pointer",
                }}
              >
                Send
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function DetailHeader({
  detail,
  onTogglePin,
  onArchive,
  onDelete,
}: {
  detail: DialogueDetail;
  onTogglePin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const c = HORIZON_COLOR[detail.horizon_label];
  const tag = detail.horizon_label === "custom"
    ? `ANCHOR · ${detail.anchor_date}`
    : `${HORIZON_LABEL[detail.horizon_label].toUpperCase()} · ${detail.anchor_date}`;
  return (
    <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", paddingBottom: 6, borderBottom: "1px solid #2a2a2a" }}>
      <span style={{ fontSize: 10, color: c, border: `1px solid ${c}`, padding: "1px 6px", letterSpacing: 0.5 }}>
        {tag}
      </span>
      <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", color: "#e8e0d2", fontSize: 16, flex: 1, minWidth: 200 }}>
        {detail.title ?? "(untitled dialogue)"}
      </span>
      <button type="button" onClick={onTogglePin} style={{ background: "transparent", border: "1px solid #333", color: detail.pinned ? "#e8b96a" : "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
        {detail.pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" onClick={onArchive} style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
        Archive
      </button>
      <button type="button" onClick={onDelete} style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
        Delete
      </button>
    </header>
  );
}

function PersonaCard({ snapshot, accent }: { snapshot: PersonaSnapshot; accent: string }) {
  const r = (snapshot.reflections ?? []).length;
  const d = (snapshot.decisions ?? []).length;
  const w = (snapshot.wins ?? []).length;
  const i = (snapshot.intentions ?? []).length;
  const ch = (snapshot.checkins ?? []).length;
  const st = (snapshot.standups ?? []).length;
  return (
    <details style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderLeft: `2px solid ${accent}`, padding: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, color: "#888", letterSpacing: 0.5, textTransform: "uppercase" }}>
        memory grounding · {r} reflections · {d} decisions · {w} wins · {i} intentions · {ch} check-ins · {st} standups
      </summary>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12, fontSize: 12, color: "#9aa28e", fontFamily: "var(--font-serif, Georgia, serif)" }}>
        {snapshot.reflections && snapshot.reflections.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, color: "#888", letterSpacing: 0.5, marginBottom: 3 }}>WHAT YOU WROTE</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5 }}>
              {snapshot.reflections.slice(0, 6).map((rf, idx) => (
                <li key={idx}><span style={{ color: "#666" }}>({rf.created_at.slice(0, 10)})</span> {rf.text.slice(0, 200)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {snapshot.decisions && snapshot.decisions.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, color: "#888", letterSpacing: 0.5, marginBottom: 3 }}>WHAT YOU CHOSE</div>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5 }}>
              {snapshot.decisions.slice(0, 5).map((dc, idx) => (
                <li key={idx}><span style={{ color: "#666" }}>({dc.created_at.slice(0, 10)})</span> {dc.title}{dc.choice ? ` — ${dc.choice}` : ""}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {snapshot.wins && snapshot.wins.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, color: "#888", letterSpacing: 0.5, marginBottom: 3 }}>WHAT YOU WON</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {snapshot.wins.slice(0, 8).map((wn, idx) => (
                <span key={idx} style={{ fontSize: 11, padding: "2px 8px", background: "#161616", border: "1px solid #2a2a2a", color: "#c8c0b2" }}>
                  {wn.text.slice(0, 100)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function MessageBubble({ message, accent, anchorLabel }: { message: Message; accent: string; anchorLabel: string }) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "85%",
          padding: 12,
          background: isUser ? "#161616" : "#0e0e0e",
          border: isUser ? "1px solid #2a2a2a" : `1px solid ${accent}`,
          borderLeft: isUser ? "1px solid #2a2a2a" : `3px solid ${accent}`,
          fontFamily: "var(--font-serif, Georgia, serif)",
          fontSize: 14,
          lineHeight: 1.6,
          color: isUser ? "#d8d0c2" : "#e8e0d2",
          whiteSpace: "pre-wrap",
        }}
      >
        {!isUser ? (
          <div style={{ fontSize: 9, color: accent, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
            {anchorLabel}
          </div>
        ) : null}
        {message.content}
      </div>
    </div>
  );
}
