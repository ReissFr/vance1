"use client";

import { useCallback, useEffect, useState } from "react";

type Horizon = "6_months" | "12_months" | "5_years";

type DialogueListItem = {
  id: string;
  horizon: Horizon;
  trajectory_id: string | null;
  title: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: string;
  role: "user" | "future_self";
  content: string;
  created_at: string;
};

type IdentityClaim = { kind: string; statement: string; occurrences: number };
type GoalRow = { title: string; target_date: string | null; current_state: string | null; status: string };
type ThemeRow = { title: string; kind: string; current_state: string | null };
type PersonaSnapshot = {
  horizon: string;
  trajectory_id: string | null;
  trajectory_body: string | null;
  trajectory_drivers: string[];
  trajectory_assumptions: string[];
  identity_claims: IdentityClaim[];
  goals: GoalRow[];
  themes: ThemeRow[];
};

type DialogueDetail = {
  id: string;
  horizon: Horizon;
  trajectory_id: string | null;
  persona_snapshot: PersonaSnapshot;
  title: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const HORIZON_LABEL: Record<Horizon, string> = {
  "6_months": "6 months from now",
  "12_months": "12 months from now",
  "5_years": "5 years from now",
};

const HORIZON_COLOR: Record<Horizon, string> = {
  "6_months": "#bfd4ee",
  "12_months": "#e8b96a",
  "5_years": "#7affcb",
};

export function FutureSelfConsole() {
  const [dialogues, setDialogues] = useState<DialogueListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<DialogueDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [newHorizon, setNewHorizon] = useState<Horizon>("12_months");
  const [newOpening, setNewOpening] = useState("");
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/future-self?status=active`, { cache: "no-store" });
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
      const r = await fetch(`/api/future-self/${id}`, { cache: "no-store" });
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
      const r = await fetch(`/api/future-self`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizon: newHorizon, opening_question: newOpening.trim() || undefined }),
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
  }, [newHorizon, newOpening, loadList]);

  const sendMessage = useCallback(async () => {
    if (!activeId) return;
    const text = draftMessage.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    setDraftMessage("");
    setMessages((prev) => [...prev, { id: `temp-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() }]);
    try {
      const r = await fetch(`/api/future-self/${activeId}/message`, {
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
      await fetch(`/api/future-self/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: pinned }) });
      void loadList();
    } catch { void loadList(); }
  }, [loadList]);

  const archive = useCallback(async (id: string) => {
    try {
      await fetch(`/api/future-self/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archive: true }) });
      if (id === activeId) setActiveId(null);
      void loadList();
    } catch { void loadList(); }
  }, [activeId, loadList]);

  const onDelete = useCallback(async (id: string) => {
    setDialogues((prev) => prev.filter((d) => d.id !== id));
    if (id === activeId) { setActiveId(null); }
    try { await fetch(`/api/future-self/${id}`, { method: "DELETE" }); }
    catch { void loadList(); }
  }, [activeId, loadList]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            Talk to future you
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${dialogues.length} dialogue${dialogues.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid #2a2a2a", background: "#1a1a1a" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>start a new dialogue with</span>
            {(["6_months", "12_months", "5_years"] as const).map((h) => {
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
          <textarea
            value={newOpening}
            onChange={(e) => setNewOpening(e.target.value)}
            placeholder="opening question (optional) — e.g. 'what was the hardest part of this year?' or 'should I take the cofounder offer?'"
            style={{ minHeight: 60, padding: 8, background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 13, fontFamily: "var(--font-serif, Georgia, serif)", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              disabled={creating}
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
            const c = HORIZON_COLOR[d.horizon];
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
                <span style={{ fontSize: 10, color: c, letterSpacing: 0.5 }}>{HORIZON_LABEL[d.horizon].toUpperCase()}</span>
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
            <PersonaCard snapshot={activeDetail.persona_snapshot} horizon={activeDetail.horizon} />
          ) : null}

          {activeId ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} horizon={activeDetail?.horizon ?? "12_months"} />
              ))}
              {sending ? (
                <div style={{ fontSize: 12, color: "#666", fontStyle: "italic", padding: 8 }}>…thinking back from {HORIZON_LABEL[activeDetail?.horizon ?? "12_months"]}</div>
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
                placeholder="ask future you anything · ⌘↵ to send"
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
  const c = HORIZON_COLOR[detail.horizon];
  return (
    <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", paddingBottom: 6, borderBottom: "1px solid #2a2a2a" }}>
      <span style={{ fontSize: 10, color: c, border: `1px solid ${c}`, padding: "1px 6px", letterSpacing: 0.5 }}>
        {HORIZON_LABEL[detail.horizon].toUpperCase()}
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

function PersonaCard({ snapshot, horizon }: { snapshot: PersonaSnapshot; horizon: Horizon }) {
  const c = HORIZON_COLOR[horizon];
  const claimsCount = (snapshot.identity_claims ?? []).length;
  const goalsCount = (snapshot.goals ?? []).length;
  const themesCount = (snapshot.themes ?? []).length;
  const hasTraj = !!snapshot.trajectory_body;
  return (
    <details style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderLeft: `2px solid ${c}`, padding: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, color: "#888", letterSpacing: 0.5, textTransform: "uppercase" }}>
        persona grounding · {claimsCount} identity claims · {goalsCount} goals · {themesCount} themes{hasTraj ? " · trajectory anchored" : " · no trajectory"}
      </summary>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "#9aa28e", fontFamily: "var(--font-serif, Georgia, serif)" }}>
        {snapshot.identity_claims && snapshot.identity_claims.length > 0 ? (
          <div>
            <div style={{ fontSize: 10, color: "#888", letterSpacing: 0.5, marginBottom: 3 }}>WHO YOU ARE</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {snapshot.identity_claims.slice(0, 12).map((cl, i) => (
                <span key={i} style={{ fontSize: 11, padding: "2px 8px", background: "#161616", border: "1px solid #2a2a2a", color: "#c8c0b2" }}>
                  {cl.statement}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {snapshot.trajectory_body ? (
          <div>
            <div style={{ fontSize: 10, color: "#888", letterSpacing: 0.5, marginBottom: 3 }}>PROJECTION ANCHOR</div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{snapshot.trajectory_body}</div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function MessageBubble({ message, horizon }: { message: Message; horizon: Horizon }) {
  const isUser = message.role === "user";
  const c = HORIZON_COLOR[horizon];
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "85%",
          padding: 12,
          background: isUser ? "#161616" : "#0e0e0e",
          border: isUser ? "1px solid #2a2a2a" : `1px solid ${c}`,
          borderLeft: isUser ? "1px solid #2a2a2a" : `3px solid ${c}`,
          fontFamily: "var(--font-serif, Georgia, serif)",
          fontSize: 14,
          lineHeight: 1.6,
          color: isUser ? "#d8d0c2" : "#e8e0d2",
          whiteSpace: "pre-wrap",
        }}
      >
        {!isUser ? (
          <div style={{ fontSize: 9, color: c, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
            you · {HORIZON_LABEL[horizon]}
          </div>
        ) : null}
        {message.content}
      </div>
    </div>
  );
}
