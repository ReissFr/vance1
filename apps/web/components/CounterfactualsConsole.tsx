"use client";

import { useCallback, useEffect, useState } from "react";

type Verdict = "regret_taken_path" | "validated_taken_path" | "neutral" | "unsure";

type DecisionRef = { id: string; title: string; choice: string | null; created_at: string };

type Counterfactual = {
  id: string;
  decision_id: string;
  alternative_choice: string;
  body: string;
  credibility: number;
  user_note: string | null;
  verdict: Verdict;
  created_at: string;
  decisions: DecisionRef | DecisionRef[] | null;
};

type Decision = { id: string; title: string; choice: string | null; created_at: string; alternatives: string | null };

const VERDICT_COLOR: Record<Verdict, string> = {
  regret_taken_path: "#f4a3a3",
  validated_taken_path: "#7affcb",
  neutral: "#bfd4ee",
  unsure: "#888",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  regret_taken_path: "regret",
  validated_taken_path: "validated",
  neutral: "neutral",
  unsure: "still unsure",
};

function decisionFromRef(ref: Counterfactual["decisions"]): DecisionRef | null {
  if (!ref) return null;
  if (Array.isArray(ref)) return ref[0] ?? null;
  return ref;
}

export function CounterfactualsConsole() {
  const [rows, setRows] = useState<Counterfactual[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [verdictFilter, setVerdictFilter] = useState<Verdict | "all">("all");
  const [error, setError] = useState<string | null>(null);

  const [pickerDecision, setPickerDecision] = useState("");
  const [pickerAlt, setPickerAlt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateNote, setGenerateNote] = useState<string | null>(null);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/counterfactuals${verdictFilter !== "all" ? `?verdict=${verdictFilter}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setRows((j.counterfactuals ?? []) as Counterfactual[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [verdictFilter]);

  const loadDecisions = useCallback(async () => {
    try {
      const r = await fetch(`/api/decisions?limit=50`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) {
        const list = (j.rows ?? j.decisions ?? []) as Decision[];
        setDecisions(list);
        if (list.length > 0 && !pickerDecision && list[0]) {
          setPickerDecision(list[0].id);
          setPickerAlt(list[0].alternatives ? list[0].alternatives.split(/[\n;,]/).map((s) => s.trim()).filter(Boolean)[0] ?? "" : "");
        }
      }
    } catch { /* noop */ }
  }, [pickerDecision]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDecisions(); }, [loadDecisions]);

  const onPickDecision = useCallback((id: string) => {
    setPickerDecision(id);
    const d = decisions.find((x) => x.id === id);
    if (d?.alternatives) {
      const first = d.alternatives.split(/[\n;,]/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) setPickerAlt(first);
    }
  }, [decisions]);

  const generate = useCallback(async () => {
    if (!pickerDecision) return;
    setGenerating(true);
    setError(null);
    setGenerateNote(null);
    try {
      const r = await fetch(`/api/decisions/${pickerDecision}/counterfactual`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alternative: pickerAlt.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "generate failed");
      setGenerateNote(`replayed · "${j.counterfactual.alternative_choice.slice(0, 80)}"`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setGenerating(false);
    }
  }, [pickerDecision, pickerAlt, load]);

  const setVerdict = useCallback(async (id: string, verdict: Verdict) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, verdict } : r)));
    try {
      await fetch(`/api/counterfactuals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const saveNote = useCallback(async (id: string, note: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, user_note: note || null } : r)));
    setEditingNoteId(null);
    setDraftNote("");
    try {
      await fetch(`/api/counterfactuals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_note: note }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const onDelete = useCallback(async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/counterfactuals/${id}`, { method: "DELETE" });
    } catch { void load(); }
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            The path not taken
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${rows.length} replay${rows.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            border: "1px solid #2a2a2a",
            background: "#1a1a1a",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>replay</span>
            <select
              value={pickerDecision}
              onChange={(e) => onPickDecision(e.target.value)}
              style={{ padding: "5px 8px", background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 12, minWidth: 240 }}
            >
              {decisions.length === 0 ? <option value="">(no decisions yet)</option> : null}
              {decisions.map((d) => (
                <option key={d.id} value={d.id}>{d.title.slice(0, 70)}{d.title.length > 70 ? "…" : ""}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#666", fontSize: 11, marginLeft: 4 }}>alternative</span>
            <input
              type="text"
              value={pickerAlt}
              onChange={(e) => setPickerAlt(e.target.value)}
              placeholder="the choice you didn't make"
              style={{ flex: 1, minWidth: 240, padding: "5px 8px", background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 12 }}
            />
            <button
              type="button"
              disabled={!pickerDecision || generating}
              onClick={generate}
              style={{
                padding: "5px 14px",
                background: !pickerDecision || generating ? "#444" : "#e8e0d2",
                color: !pickerDecision || generating ? "#888" : "#111",
                border: "1px solid #e8e0d2",
                fontSize: 12,
                cursor: !pickerDecision || generating ? "not-allowed" : "pointer",
              }}
            >
              {generating ? "replaying…" : "Replay"}
            </button>
          </div>
        </div>
        {generateNote ? <div style={{ color: "#9aa28e", fontSize: 12 }}>{generateNote}</div> : null}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["all", "regret_taken_path", "validated_taken_path", "neutral", "unsure"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdictFilter(v)}
              style={{
                padding: "3px 9px",
                background: verdictFilter === v ? "#e8e0d2" : "transparent",
                color: verdictFilter === v ? "#111" : "#aaa",
                border: "1px solid " + (verdictFilter === v ? "#e8e0d2" : "#333"),
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {v === "all" ? "All" : VERDICT_LABEL[v as Verdict]}
            </button>
          ))}
        </div>
      </header>

      {error ? <div style={{ color: "#f4a3a3" }}>{error}</div> : null}

      {!loading && rows.length === 0 ? (
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
          No replays yet. Pick a past decision above and replay the path you didn't take.
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map((cf) => (
          <Card
            key={cf.id}
            cf={cf}
            isEditingNote={editingNoteId === cf.id}
            draftNote={draftNote}
            onBeginEditNote={() => { setEditingNoteId(cf.id); setDraftNote(cf.user_note ?? ""); }}
            onCancelEditNote={() => { setEditingNoteId(null); setDraftNote(""); }}
            onSaveNote={(note) => saveNote(cf.id, note)}
            onChangeDraftNote={setDraftNote}
            onSetVerdict={(v) => setVerdict(cf.id, v)}
            onDelete={() => onDelete(cf.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  cf,
  isEditingNote,
  draftNote,
  onBeginEditNote,
  onCancelEditNote,
  onSaveNote,
  onChangeDraftNote,
  onSetVerdict,
  onDelete,
}: {
  cf: Counterfactual;
  isEditingNote: boolean;
  draftNote: string;
  onBeginEditNote: () => void;
  onCancelEditNote: () => void;
  onSaveNote: (note: string) => void;
  onChangeDraftNote: (s: string) => void;
  onSetVerdict: (v: Verdict) => void;
  onDelete: () => void;
}) {
  const dec = decisionFromRef(cf.decisions);
  const color = VERDICT_COLOR[cf.verdict];
  return (
    <article
      style={{
        padding: 16,
        background: "#161616",
        borderLeft: `3px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <a href="/decisions" style={{ fontSize: 11, letterSpacing: 1, color: "#888", textDecoration: "none", textTransform: "uppercase" }}>
          Decision · {cf.created_at.slice(0, 10)}
        </a>
        <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", color: "#e8e0d2", fontSize: 16 }}>
          {dec?.title ?? "(decision)"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color, border: `1px solid ${color}`, padding: "1px 6px", letterSpacing: 0.5 }}>
          {VERDICT_LABEL[cf.verdict].toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: "#666" }}>credibility {cf.credibility}/5</span>
        <button type="button" onClick={onDelete} style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
          Delete
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888", marginBottom: 4 }}>PATH TAKEN</div>
          <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#e8e0d2", fontSize: 14, lineHeight: 1.4 }}>
            {dec?.choice ?? "(no choice recorded)"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color, marginBottom: 4 }}>PATH REPLAYED</div>
          <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", color, fontSize: 14, lineHeight: 1.4 }}>
            {cf.alternative_choice}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: 12,
          background: "#0e0e0e",
          borderLeft: "2px solid " + color,
          fontFamily: "var(--font-serif, Georgia, serif)",
          fontSize: 14,
          lineHeight: 1.6,
          color: "#d8d0c2",
          whiteSpace: "pre-wrap",
        }}
      >
        {cf.body}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#666" }}>after reading this, your verdict on the path you took:</span>
        {(["regret_taken_path", "validated_taken_path", "neutral", "unsure"] as Verdict[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onSetVerdict(v)}
            style={{
              padding: "3px 9px",
              background: cf.verdict === v ? VERDICT_COLOR[v] : "transparent",
              color: cf.verdict === v ? "#111" : VERDICT_COLOR[v],
              border: "1px solid " + VERDICT_COLOR[v],
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {VERDICT_LABEL[v]}
          </button>
        ))}
      </div>

      {!isEditingNote ? (
        <div
          onClick={onBeginEditNote}
          style={{
            padding: 8,
            border: "1px solid #2a2a2a",
            background: "#0e0e0e",
            cursor: "text",
            fontFamily: "var(--font-serif, Georgia, serif)",
            fontSize: 13,
            color: cf.user_note ? "#d8d0c2" : "#666",
            fontStyle: cf.user_note ? "normal" : "italic",
          }}
        >
          {cf.user_note ?? "leave a note for future you · how this replay landed"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={draftNote}
            onChange={(e) => onChangeDraftNote(e.target.value)}
            placeholder="how did the replay land?"
            style={{ minHeight: 60, padding: 8, background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 13, fontFamily: "var(--font-serif, Georgia, serif)" }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancelEditNote} style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>Cancel</button>
            <button type="button" onClick={() => onSaveNote(draftNote.trim())} style={{ background: "#e8e0d2", border: "1px solid #e8e0d2", color: "#111", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>Save</button>
          </div>
        </div>
      )}
    </article>
  );
}
