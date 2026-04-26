"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type StatusFilter = "active" | "pinned" | "archived" | "all";

type SourceCounts = Record<string, number>;

type Mirror = {
  id: string;
  body: string;
  drift_note: string | null;
  window_days: number;
  window_start: string;
  window_end: string;
  source_counts: SourceCounts;
  parent_id: string | null;
  user_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
};

const SOURCE_LABEL: Record<string, string> = {
  reflections: "reflections",
  decisions: "decisions",
  wins: "wins",
  intentions: "intentions",
  standups: "standups",
  checkins: "check-ins",
  open_questions: "open questions",
  observations: "observations",
  identity: "identity claims",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SelfMirrorConsole() {
  const [mirrors, setMirrors] = useState<Mirror[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [windowDays, setWindowDays] = useState<3 | 7 | 14 | 30 | 90>(7);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

  const refresh = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/self-mirrors?status=${status}&limit=100`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      const list = (Array.isArray(j.mirrors) ? j.mirrors : []) as Mirror[];
      setMirrors(list);
      if (list.length > 0 && (!activeId || !list.some((m) => m.id === activeId))) {
        setActiveId(list[0]?.id ?? null);
      } else if (list.length === 0) {
        setActiveId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => { void refresh(filter); }, [filter, refresh]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/self-mirrors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "generation failed");
      await refresh(filter);
      if (j?.mirror?.id) setActiveId(j.mirror.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setGenerating(false);
    }
  }, [windowDays, filter, refresh]);

  const patch = useCallback(async (id: string, patch: Record<string, unknown>) => {
    try {
      const r = await fetch(`/api/self-mirrors/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("update failed");
      await refresh(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "update failed");
    }
  }, [filter, refresh]);

  const remove = useCallback(async (id: string) => {
    if (!confirm("Delete this mirror? This can't be undone.")) return;
    try {
      const r = await fetch(`/api/self-mirrors/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      await refresh(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }, [filter, refresh]);

  const saveNote = useCallback(async (id: string) => {
    await patch(id, { user_note: editNote.trim() });
    setEditingNoteId(null);
    setEditNote("");
  }, [editNote, patch]);

  const active = useMemo(() => mirrors.find((m) => m.id === activeId) ?? null, [mirrors, activeId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 80 }}>
      {/* Generate panel */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: 20,
          background: "rgba(20,22,26,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, opacity: 0.6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Window</label>
            <div style={{ display: "flex", gap: 4 }}>
              {([3, 7, 14, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setWindowDays(d)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: windowDays === d ? "#e8e0d2" : "rgba(255,255,255,0.04)",
                    color: windowDays === d ? "#1a1c20" : "rgba(255,255,255,0.7)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: generating ? "rgba(232,224,210,0.4)" : "#e8e0d2",
              color: "#1a1c20",
              fontSize: 13,
              fontWeight: 600,
              cursor: generating ? "wait" : "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {generating ? "Looking…" : "Take a mirror"}
          </button>
        </div>
        {error && <div style={{ fontSize: 12, color: "#f4a3a3" }}>{error}</div>}
      </div>

      {/* Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 24, alignItems: "start" }}>
        {/* Sidebar — timeline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 80 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["active", "pinned", "archived", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: filter === s ? "rgba(255,255,255,0.12)" : "transparent",
                  color: filter === s ? "#fff" : "rgba(255,255,255,0.6)",
                  fontSize: 11,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "70vh", overflowY: "auto" }}>
            {loading && mirrors.length === 0 ? (
              <div style={{ opacity: 0.5, fontSize: 12, padding: 12 }}>Loading…</div>
            ) : mirrors.length === 0 ? (
              <div style={{ opacity: 0.55, fontSize: 12, padding: 12, border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 10 }}>
                No mirrors yet.
              </div>
            ) : (
              mirrors.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveId(m.id)}
                  style={{
                    textAlign: "left",
                    border: m.pinned ? "1px solid rgba(232,224,210,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: activeId === m.id ? "rgba(255,255,255,0.06)" : "transparent",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {m.pinned && <span style={{ color: "#e8e0d2", marginRight: 4 }}>★</span>}
                    {formatDate(m.created_at)}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.5, letterSpacing: "0.04em" }}>
                    {m.window_days}d window
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main — active mirror */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!active ? (
            <div style={{ opacity: 0.55, fontSize: 13, padding: 32, textAlign: "center", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 14 }}>
              {filter === "active"
                ? "No mirror selected. Take one above to see how you appear right now."
                : "Pick a mirror from the timeline."}
            </div>
          ) : (
            <ActiveMirror
              mirror={active}
              editingNoteId={editingNoteId}
              editNote={editNote}
              setEditingNoteId={setEditingNoteId}
              setEditNote={setEditNote}
              saveNote={saveNote}
              patch={patch}
              remove={remove}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ActiveMirror({
  mirror,
  editingNoteId,
  editNote,
  setEditingNoteId,
  setEditNote,
  saveNote,
  patch,
  remove,
}: {
  mirror: Mirror;
  editingNoteId: string | null;
  editNote: string;
  setEditingNoteId: (id: string | null) => void;
  setEditNote: (n: string) => void;
  saveNote: (id: string) => void;
  patch: (id: string, p: Record<string, unknown>) => void;
  remove: (id: string) => void;
}) {
  const counts = mirror.source_counts ?? {};
  const countEntries = Object.entries(counts).filter(([, v]) => typeof v === "number" && v > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, opacity: 0.95 }}>
          {formatDate(mirror.created_at)}
        </div>
        <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.04em" }}>
          {mirror.window_start} → {mirror.window_end} · {mirror.window_days}d window · taken {formatTime(mirror.created_at)}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => patch(mirror.id, { pin: !mirror.pinned })} style={btnGhost}>
          {mirror.pinned ? "★ Unpin" : "☆ Pin"}
        </button>
        {mirror.archived_at ? (
          <button type="button" onClick={() => patch(mirror.id, { restore: true })} style={btnGhost}>Restore</button>
        ) : (
          <button type="button" onClick={() => patch(mirror.id, { archive: true })} style={btnGhost}>Archive</button>
        )}
        <button type="button" onClick={() => remove(mirror.id)} style={{ ...btnGhost, color: "#f4a3a3" }}>Delete</button>
      </div>

      {/* Drift */}
      {mirror.drift_note && (
        <div
          style={{
            fontSize: 13,
            fontStyle: "italic",
            padding: "10px 14px",
            borderLeft: "2px solid #fbb86d",
            background: "rgba(251,184,108,0.08)",
            borderRadius: "0 8px 8px 0",
            color: "rgba(255,255,255,0.92)",
          }}
        >
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6, marginRight: 8 }}>Drift</span>
          {mirror.drift_note}
        </div>
      )}

      {/* Body */}
      <div
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 17,
          lineHeight: 1.7,
          color: "rgba(255,255,255,0.92)",
          padding: 24,
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          background: "rgba(232,224,210,0.04)",
          whiteSpace: "pre-wrap",
        }}
      >
        {mirror.body}
      </div>

      {/* Source counts */}
      {countEntries.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {countEntries.map(([k, v]) => (
            <span
              key={k}
              style={{
                fontSize: 10,
                padding: "3px 9px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.55)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {v} {SOURCE_LABEL[k] ?? k}
            </span>
          ))}
        </div>
      )}

      {/* User note */}
      {editingNoteId === mirror.id ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="Yes that's me / no that's not me / freeform reaction"
            rows={3}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              padding: 10,
              color: "#fff",
              fontSize: 13,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => saveNote(mirror.id)} style={btnSecondary}>Save</button>
            <button type="button" onClick={() => { setEditingNoteId(null); setEditNote(""); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      ) : mirror.user_note ? (
        <div
          style={{
            fontSize: 13,
            padding: "10px 14px",
            borderLeft: "2px solid #bfd4ee",
            background: "rgba(191,212,238,0.06)",
            borderRadius: "0 8px 8px 0",
            color: "rgba(255,255,255,0.85)",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.55, marginTop: 2 }}>You</span>
          <div style={{ flex: 1, fontStyle: "italic" }}>{mirror.user_note}</div>
          <button type="button" onClick={() => { setEditingNoteId(mirror.id); setEditNote(mirror.user_note ?? ""); }} style={btnGhost}>Edit</button>
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => { setEditingNoteId(mirror.id); setEditNote(""); }} style={btnGhost}>+ React</button>
        </div>
      )}
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontSize: 12,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "transparent",
  color: "rgba(255,255,255,0.65)",
  fontSize: 11,
  cursor: "pointer",
};
