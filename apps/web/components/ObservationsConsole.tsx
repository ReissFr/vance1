"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Kind = "pattern" | "contradiction" | "blind_spot" | "growth" | "encouragement" | "question";

type SourceRef = { kind: string; id: string; snippet: string };

type Observation = {
  id: string;
  kind: Kind;
  body: string;
  confidence: number;
  source_refs: SourceRef[];
  window_days: number;
  pinned: boolean;
  dismissed_at: string | null;
  created_at: string;
};

type StatusFilter = "active" | "pinned" | "dismissed" | "all";

const KIND_LABEL: Record<Kind, string> = {
  pattern: "Pattern",
  contradiction: "Contradiction",
  blind_spot: "Blind spot",
  growth: "Growth",
  encouragement: "Encouragement",
  question: "Question",
};

const KIND_COLOR: Record<Kind, string> = {
  pattern: "#bfd4ee",
  contradiction: "#f4a3a3",
  blind_spot: "#cdb6ff",
  growth: "#7affcb",
  encouragement: "#ffd76b",
  question: "#fbb86d",
};

const SOURCE_HREF: Record<string, string> = {
  win: "/wins",
  reflection: "/reflections",
  decision: "/decisions",
  prediction: "/predictions",
  intention: "/intentions",
  standup: "/standups",
  theme: "/themes",
  policy: "/policies",
};

export function ObservationsConsole() {
  const [rows, setRows] = useState<Observation[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [kindFilter, setKindFilter] = useState<Kind | "all">("all");
  const [windowDays, setWindowDays] = useState<7 | 14 | 30 | 60>(30);
  const [maxObs, setMaxObs] = useState<number>(6);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generateNote, setGenerateNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/observations?status=${statusFilter}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setRows((j.observations ?? []) as Observation[]);
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
      const r = await fetch("/api/observations/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays, max: maxObs }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "generate failed");
      const generated = (j.generated ?? []) as Observation[];
      if (generated.length === 0 && j.note) setGenerateNote(j.note);
      else setGenerateNote(`scan complete · ${generated.length} new observation${generated.length === 1 ? "" : "s"}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setGenerating(false);
    }
  }, [windowDays, maxObs, load]);

  const filtered = useMemo(() => {
    if (kindFilter === "all") return rows;
    return rows.filter((r) => r.kind === kindFilter);
  }, [rows, kindFilter]);

  const kindCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [rows]);

  const onPin = useCallback(async (id: string, pin: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, pinned: pin } : r)));
    try {
      await fetch(`/api/observations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const onDismiss = useCallback(async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/observations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dismiss: true }),
      });
    } catch { void load(); }
  }, [load]);

  const onRestore = useCallback(async (id: string) => {
    try {
      await fetch(`/api/observations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      void load();
    } catch { /* noop */ }
  }, [load]);

  const onDelete = useCallback(async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/observations/${id}`, { method: "DELETE" });
    } catch { void load(); }
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            What the brain has noticed
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${filtered.length} observation${filtered.length === 1 ? "" : "s"}`}
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
            run a scan
          </span>
          <span style={{ color: "#666", fontSize: 11 }}>last</span>
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d as 7 | 14 | 30 | 60)}
              style={{
                padding: "3px 9px",
                background: windowDays === d ? "#e8e0d2" : "transparent",
                color: windowDays === d ? "#111" : "#aaa",
                border: "1px solid " + (windowDays === d ? "#e8e0d2" : "#333"),
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {d}d
            </button>
          ))}
          <span style={{ color: "#666", fontSize: 11, marginLeft: 6 }}>up to</span>
          <input
            type="number"
            min={1}
            max={12}
            value={maxObs}
            onChange={(e) => setMaxObs(Math.max(1, Math.min(12, Number(e.target.value) || 6)))}
            style={{ width: 50, padding: "3px 6px", background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 12 }}
          />
          <span style={{ color: "#666", fontSize: 11 }}>observations</span>
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
              cursor: generating ? "wait" : "pointer",
            }}
          >
            {generating ? "scanning…" : "Run scan"}
          </button>
        </div>
        {generateNote ? <div style={{ color: "#9aa28e", fontSize: 12 }}>{generateNote}</div> : null}

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {(["active", "pinned", "dismissed", "all"] as StatusFilter[]).map((s) => (
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
          {Object.keys(kindCounts).length > 0 ? (
            <>
              <span style={{ color: "#444", fontSize: 11 }}>·</span>
              <button
                type="button"
                onClick={() => setKindFilter("all")}
                style={{
                  padding: "3px 9px",
                  background: kindFilter === "all" ? "#888" : "transparent",
                  color: kindFilter === "all" ? "#111" : "#888",
                  border: "1px solid #888",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                All · {rows.length}
              </button>
              {(Object.keys(kindCounts) as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  style={{
                    padding: "3px 9px",
                    background: kindFilter === k ? KIND_COLOR[k] : "transparent",
                    color: kindFilter === k ? "#111" : KIND_COLOR[k],
                    border: "1px solid " + KIND_COLOR[k],
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {KIND_LABEL[k]} · {kindCounts[k]}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </header>

      {error ? <div style={{ color: "#f4a3a3" }}>{error}</div> : null}

      {!loading && filtered.length === 0 ? (
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
          {statusFilter === "active"
            ? "Nothing yet. Run a scan and the brain will tell you what it's noticed."
            : statusFilter === "pinned"
            ? "Nothing pinned."
            : statusFilter === "dismissed"
            ? "Nothing dismissed."
            : "Empty."}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((obs) => (
          <Card key={obs.id} obs={obs} onPin={onPin} onDismiss={onDismiss} onRestore={onRestore} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function Card({
  obs,
  onPin,
  onDismiss,
  onRestore,
  onDelete,
}: {
  obs: Observation;
  onPin: (id: string, pin: boolean) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const color = KIND_COLOR[obs.kind];
  const dismissed = obs.dismissed_at !== null;
  return (
    <div
      style={{
        padding: 14,
        background: dismissed ? "#141414" : "#181818",
        borderLeft: `3px solid ${color}`,
        opacity: dismissed ? 0.5 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, letterSpacing: 0.5, color, textTransform: "uppercase" }}>
          {KIND_LABEL[obs.kind]}
        </span>
        <span style={{ fontSize: 11, color: "#666" }}>· confidence {obs.confidence}/5</span>
        <span style={{ fontSize: 11, color: "#666" }}>· {obs.window_days}d window</span>
        <span style={{ fontSize: 11, color: "#444" }}>· {obs.created_at.slice(0, 10)}</span>
        {obs.pinned ? <span style={{ fontSize: 10, color: "#ffd76b", border: "1px solid #ffd76b", padding: "1px 5px" }}>PINNED</span> : null}
        <span style={{ flex: 1 }} />
        {!dismissed ? (
          <>
            <button
              type="button"
              onClick={() => onPin(obs.id, !obs.pinned)}
              style={{ background: "transparent", border: "1px solid #333", color: obs.pinned ? "#ffd76b" : "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
            >
              {obs.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(obs.id)}
              style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
            >
              Dismiss
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onRestore(obs.id)}
              style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => onDelete(obs.id)}
              style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#e8e0d2", fontSize: 16, lineHeight: 1.5 }}>
        {obs.body}
      </div>

      {obs.source_refs.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 6, borderTop: "1px solid #222" }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#666", textTransform: "uppercase" }}>grounded in</div>
          {obs.source_refs.map((ref, i) => {
            const href = SOURCE_HREF[ref.kind] ?? "/recall";
            return (
              <a
                key={`${ref.kind}-${ref.id}-${i}`}
                href={href}
                style={{ fontSize: 12, color: "#9aa28e", textDecoration: "none" }}
              >
                <span style={{ color: KIND_COLOR[obs.kind], opacity: 0.6 }}>{ref.kind}</span>
                {ref.snippet ? <span style={{ color: "#888" }}> · {ref.snippet}</span> : null}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
