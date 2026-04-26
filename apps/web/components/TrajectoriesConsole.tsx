"use client";

import { useCallback, useEffect, useState } from "react";

type Trajectory = {
  id: string;
  body_6m: string;
  body_12m: string;
  key_drivers: string[];
  assumptions: string[];
  confidence: number;
  source_counts: Record<string, number>;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
};

type StatusFilter = "active" | "archived" | "pinned" | "all";

export function TrajectoriesConsole() {
  const [rows, setRows] = useState<Trajectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generateNote, setGenerateNote] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [openHorizon, setOpenHorizon] = useState<Record<string, "6m" | "12m">>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/trajectories?status=${statusFilter}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setRows((j.trajectories ?? []) as Trajectory[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setGenerateNote(null);
    try {
      const r = await fetch(`/api/trajectories/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "generate failed");
      const t = j.trajectory as Trajectory | undefined;
      if (t) setGenerateNote(`projected · confidence ${t.confidence}/5 · ${(t.key_drivers ?? []).length} drivers`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setGenerating(false);
    }
  }, [load]);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, pinned } : r)));
    try {
      await fetch(`/api/trajectories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: pinned }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const archive = useCallback(async (id: string) => {
    try {
      await fetch(`/api/trajectories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const restore = useCallback(async (id: string) => {
    try {
      await fetch(`/api/trajectories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const onDelete = useCallback(async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/trajectories/${id}`, { method: "DELETE" });
    } catch { void load(); }
  }, [load]);

  const setHorizon = useCallback((id: string, h: "6m" | "12m") => {
    setOpenHorizon((prev) => ({ ...prev, [id]: h }));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            If you don&rsquo;t change course
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${rows.length} projection${rows.length === 1 ? "" : "s"}`}
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
            <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>project forward</span>
            <span style={{ color: "#666", fontSize: 11 }}>
              uses your active goals, themes, policies, predictions, plus 60 days of wins, reflections, intentions
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              disabled={generating}
              onClick={generate}
              style={{
                padding: "5px 14px",
                background: generating ? "#444" : "#e8e0d2",
                color: generating ? "#888" : "#111",
                border: "1px solid #e8e0d2",
                fontSize: 12,
                cursor: generating ? "not-allowed" : "pointer",
              }}
            >
              {generating ? "projecting…" : "Run projection"}
            </button>
          </div>
        </div>
        {generateNote ? <div style={{ color: "#9aa28e", fontSize: 12 }}>{generateNote}</div> : null}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["active", "pinned", "archived", "all"] as const).map((s) => (
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
              {s}
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
          No projections yet. Run one to see where the current trajectory lands you in 6 and 12 months.
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {rows.map((t) => (
          <Card
            key={t.id}
            t={t}
            horizon={openHorizon[t.id] ?? "6m"}
            onSetHorizon={(h) => setHorizon(t.id, h)}
            onTogglePin={() => togglePin(t.id, !t.pinned)}
            onArchive={() => archive(t.id)}
            onRestore={() => restore(t.id)}
            onDelete={() => onDelete(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  t,
  horizon,
  onSetHorizon,
  onTogglePin,
  onArchive,
  onRestore,
  onDelete,
}: {
  t: Trajectory;
  horizon: "6m" | "12m";
  onSetHorizon: (h: "6m" | "12m") => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const isArchived = !!t.archived_at;
  const accent = horizon === "6m" ? "#bfd4ee" : "#e8b96a";
  const body = horizon === "6m" ? t.body_6m : t.body_12m;
  const drivers = Array.isArray(t.key_drivers) ? t.key_drivers : [];
  const assumptions = Array.isArray(t.assumptions) ? t.assumptions : [];
  const counts = t.source_counts ?? {};
  const countsLine = Object.entries(counts)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
    .join(" · ");

  return (
    <article
      style={{
        padding: 16,
        background: isArchived ? "#101010" : "#161616",
        borderLeft: `3px solid ${accent}`,
        opacity: isArchived ? 0.6 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#888", textTransform: "uppercase" }}>
          Projection · {t.created_at.slice(0, 10)}
        </span>
        {t.pinned ? (
          <span style={{ fontSize: 10, color: "#e8b96a", border: "1px solid #e8b96a", padding: "1px 6px", letterSpacing: 0.5 }}>
            PINNED
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#666" }}>confidence {t.confidence}/5</span>
        <button
          type="button"
          onClick={onTogglePin}
          style={{ background: "transparent", border: "1px solid #333", color: t.pinned ? "#e8b96a" : "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
        >
          {t.pinned ? "Unpin" : "Pin"}
        </button>
        {isArchived ? (
          <button
            type="button"
            onClick={onRestore}
            style={{ background: "transparent", border: "1px solid #333", color: "#9aa28e", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={onArchive}
            style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
          >
            Archive
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
        >
          Delete
        </button>
      </header>

      <div style={{ display: "flex", gap: 6 }}>
        {(["6m", "12m"] as const).map((h) => {
          const active = horizon === h;
          const c = h === "6m" ? "#bfd4ee" : "#e8b96a";
          return (
            <button
              key={h}
              type="button"
              onClick={() => onSetHorizon(h)}
              style={{
                padding: "4px 14px",
                background: active ? c : "transparent",
                color: active ? "#111" : c,
                border: `1px solid ${c}`,
                fontSize: 12,
                letterSpacing: 0.5,
                cursor: "pointer",
              }}
            >
              {h === "6m" ? "6 months" : "12 months"}
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: 14,
          background: "#0e0e0e",
          borderLeft: `2px solid ${accent}`,
          fontFamily: "var(--font-serif, Georgia, serif)",
          fontSize: 14,
          lineHeight: 1.7,
          color: "#d8d0c2",
          whiteSpace: "pre-wrap",
        }}
      >
        {body}
      </div>

      {drivers.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888" }}>KEY DRIVERS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {drivers.map((d, i) => (
              <span key={i} style={{ fontSize: 11, padding: "2px 8px", border: "1px solid #2a2a2a", color: "#c8c0b2", background: "#161616" }}>
                {d}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {assumptions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888" }}>ASSUMES</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: "#9aa28e", fontSize: 12, lineHeight: 1.5, fontStyle: "italic", fontFamily: "var(--font-serif, Georgia, serif)" }}>
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {countsLine ? (
        <div style={{ fontSize: 10, color: "#555", letterSpacing: 0.5 }}>
          grounded in: {countsLine}
        </div>
      ) : null}
    </article>
  );
}
