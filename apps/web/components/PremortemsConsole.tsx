"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Status = "watching" | "happened" | "avoided" | "dismissed";

type DecisionRef = { id: string; title: string; choice: string | null; created_at: string };

type Premortem = {
  id: string;
  decision_id: string;
  failure_mode: string;
  likelihood: number;
  mitigation: string | null;
  status: Status;
  resolved_at: string | null;
  resolved_note: string | null;
  created_at: string;
  decisions: DecisionRef | DecisionRef[] | null;
};

type Decision = {
  id: string;
  title: string;
  choice: string | null;
  created_at: string;
};

const STATUS_COLOR: Record<Status, string> = {
  watching: "#bfd4ee",
  happened: "#f4a3a3",
  avoided: "#7affcb",
  dismissed: "#888",
};

const STATUS_LABEL: Record<Status, string> = {
  watching: "Watching",
  happened: "Happened",
  avoided: "Avoided",
  dismissed: "Dismissed",
};

function decisionFromRef(ref: Premortem["decisions"]): DecisionRef | null {
  if (!ref) return null;
  if (Array.isArray(ref)) return ref[0] ?? null;
  return ref;
}

export function PremortemsConsole() {
  const [rows, setRows] = useState<Premortem[]>([]);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("watching");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [pickerDecision, setPickerDecision] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [generateNote, setGenerateNote] = useState<string | null>(null);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [pendingStatus, setPendingStatus] = useState<Status | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/premortems?status=${statusFilter}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setRows((j.premortems ?? []) as Premortem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadDecisions = useCallback(async () => {
    try {
      const r = await fetch(`/api/decisions?limit=50`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) {
        const list = (j.decisions ?? j.rows ?? []) as Decision[];
        setDecisions(list);
        if (list.length > 0 && !pickerDecision && list[0]) setPickerDecision(list[0].id);
      }
    } catch { /* noop */ }
  }, [pickerDecision]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDecisions(); }, [loadDecisions]);

  const generate = useCallback(async () => {
    if (!pickerDecision) return;
    setGenerating(true);
    setGenerateNote(null);
    setError(null);
    try {
      const r = await fetch(`/api/decisions/${pickerDecision}/premortem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 4, replace: false }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "generate failed");
      const generated = (j.generated ?? []) as Premortem[];
      setGenerateNote(generated.length > 0 ? `${generated.length} failure mode${generated.length === 1 ? "" : "s"} added` : (j.note ?? "no failure modes returned"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setGenerating(false);
    }
  }, [pickerDecision, load]);

  const updateStatus = useCallback(async (id: string, status: Status, note: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status, resolved_note: note || null } : r)));
    try {
      await fetch(`/api/premortems/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      await load();
    } catch { void load(); }
    setResolvingId(null);
    setPendingStatus(null);
    setResolveNote("");
  }, [load]);

  const onDelete = useCallback(async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/premortems/${id}`, { method: "DELETE" });
    } catch { void load(); }
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, { decision: DecisionRef | null; modes: Premortem[] }>();
    for (const p of rows) {
      const key = p.decision_id;
      const existing = map.get(key);
      if (existing) existing.modes.push(p);
      else map.set(key, { decision: decisionFromRef(p.decisions), modes: [p] });
    }
    return Array.from(map.entries()).map(([id, v]) => ({ decisionId: id, decision: v.decision, modes: v.modes }));
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { watching: 0, happened: 0, avoided: 0, dismissed: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            How each decision could fail
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${rows.length} mode${rows.length === 1 ? "" : "s"} across ${grouped.length} decision${grouped.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            padding: 12,
            border: "1px solid #2a2a2a",
            background: "#1a1a1a",
          }}
        >
          <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>
            run a pre-mortem on
          </span>
          <select
            value={pickerDecision}
            onChange={(e) => setPickerDecision(e.target.value)}
            style={{ padding: "5px 8px", background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 12, minWidth: 220 }}
          >
            {decisions.length === 0 ? <option value="">(no decisions yet — log one first)</option> : null}
            {decisions.map((d) => (
              <option key={d.id} value={d.id}>{d.title.slice(0, 60)}{d.title.length > 60 ? "…" : ""}</option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
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
            {generating ? "thinking…" : "Generate failure modes"}
          </button>
        </div>
        {generateNote ? <div style={{ color: "#9aa28e", fontSize: 12 }}>{generateNote}</div> : null}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["watching", "happened", "avoided", "dismissed", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "3px 9px",
                background: statusFilter === s ? "#e8e0d2" : "transparent",
                color: statusFilter === s ? "#111" : "#aaa",
                border: "1px solid " + (statusFilter === s ? "#e8e0d2" : "#333"),
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {s === "all" ? "All" : `${STATUS_LABEL[s]} · ${counts[s]}`}
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
          {statusFilter === "watching"
            ? "No active failure-watch items. Pick a decision above and generate to start watching."
            : "Nothing in this status."}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {grouped.map((g) => (
          <section key={g.decisionId} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <header style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <a href="/decisions" style={{ fontSize: 11, letterSpacing: 1, color: "#888", textDecoration: "none", textTransform: "uppercase" }}>
                Decision
              </a>
              <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", color: "#e8e0d2", fontSize: 16 }}>
                {g.decision?.title ?? "(decision)"}
              </span>
              {g.decision?.choice ? (
                <span style={{ color: "#9aa28e", fontSize: 13 }}>· {g.decision.choice}</span>
              ) : null}
            </header>
            {g.modes.map((m) => (
              <ModeRow
                key={m.id}
                mode={m}
                isResolving={resolvingId === m.id}
                resolveNote={resolveNote}
                pendingStatus={pendingStatus}
                onBeginResolve={(s) => { setResolvingId(m.id); setPendingStatus(s); setResolveNote(m.resolved_note ?? ""); }}
                onCancelResolve={() => { setResolvingId(null); setPendingStatus(null); setResolveNote(""); }}
                onConfirmResolve={() => updateStatus(m.id, pendingStatus ?? "happened", resolveNote.trim())}
                onChangeNote={setResolveNote}
                onDelete={() => onDelete(m.id)}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function ModeRow({
  mode,
  isResolving,
  resolveNote,
  pendingStatus,
  onBeginResolve,
  onCancelResolve,
  onConfirmResolve,
  onChangeNote,
  onDelete,
}: {
  mode: Premortem;
  isResolving: boolean;
  resolveNote: string;
  pendingStatus: Status | null;
  onBeginResolve: (status: Status) => void;
  onCancelResolve: () => void;
  onConfirmResolve: () => void;
  onChangeNote: (s: string) => void;
  onDelete: () => void;
}) {
  const color = STATUS_COLOR[mode.status];
  return (
    <div
      style={{
        padding: 12,
        background: "#171717",
        borderLeft: `3px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, letterSpacing: 1, color, border: `1px solid ${color}`, padding: "1px 5px" }}>
          {STATUS_LABEL[mode.status].toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: "#888" }}>likelihood {mode.likelihood}/5</span>
        <span style={{ flex: 1 }} />
        {mode.status === "watching" && !isResolving ? (
          <>
            <button type="button" onClick={() => onBeginResolve("happened")} style={miniBtn("#f4a3a3")}>Happened</button>
            <button type="button" onClick={() => onBeginResolve("avoided")} style={miniBtn("#7affcb")}>Avoided</button>
            <button type="button" onClick={() => onBeginResolve("dismissed")} style={miniBtn("#888")}>Dismiss</button>
          </>
        ) : null}
        {mode.status !== "watching" && !isResolving ? (
          <>
            <button type="button" onClick={() => onBeginResolve("watching")} style={miniBtn("#bfd4ee")}>Re-watch</button>
            <button type="button" onClick={onDelete} style={miniBtn("#a14040")}>Delete</button>
          </>
        ) : null}
      </div>

      <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#e8e0d2", fontSize: 15, lineHeight: 1.5 }}>
        {mode.failure_mode}
      </div>

      {mode.mitigation ? (
        <div style={{ fontSize: 12, color: "#9aa28e", borderLeft: "2px solid #2a2a2a", paddingLeft: 8 }}>
          mitigation: {mode.mitigation}
        </div>
      ) : null}

      {mode.resolved_note ? (
        <div style={{ fontStyle: "italic", fontSize: 12, color: "#aaa", borderLeft: "2px solid " + color, paddingLeft: 8 }}>
          {mode.resolved_note}
        </div>
      ) : null}

      {isResolving ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, background: "#0e0e0e", border: "1px solid #2a2a2a" }}>
          <div style={{ fontSize: 11, color: "#aaa" }}>
            Marking as <strong style={{ color: STATUS_COLOR[pendingStatus ?? "watching"] }}>{STATUS_LABEL[pendingStatus ?? "watching"]}</strong> — leave a note for future you (optional)
          </div>
          <textarea
            value={resolveNote}
            onChange={(e) => onChangeNote(e.target.value)}
            placeholder="why this happened / how you avoided it / why it didn't apply"
            style={{ minHeight: 50, padding: 6, background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 13, fontFamily: "var(--font-serif, Georgia, serif)" }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancelResolve} style={miniBtn("#aaa")}>Cancel</button>
            <button type="button" onClick={onConfirmResolve} style={miniBtn("#e8e0d2", true)}>Save</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function miniBtn(color: string, filled = false): React.CSSProperties {
  return {
    background: filled ? color : "transparent",
    color: filled ? "#111" : color,
    border: "1px solid " + color,
    fontSize: 11,
    padding: "2px 8px",
    cursor: "pointer",
  };
}
