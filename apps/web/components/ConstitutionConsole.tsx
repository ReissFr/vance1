"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Article = {
  kind: "identity" | "value" | "refuse" | "how_i_work" | "how_i_decide" | "what_im_building";
  title: string;
  body: string;
  citations: Array<{ kind: string; id: string }>;
};

type Constitution = {
  id: string;
  version: number;
  parent_id: string | null;
  preamble: string | null;
  body: string;
  articles: Article[];
  source_counts: Record<string, number>;
  diff_summary: string | null;
  is_current: boolean;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  created_at: string;
  updated_at: string;
};

type StatusFilter = "current" | "history" | "pinned" | "archived";

const KIND_ORDER: Article["kind"][] = ["identity", "value", "refuse", "how_i_work", "how_i_decide", "what_im_building"];

const KIND_LABEL: Record<Article["kind"], string> = {
  identity: "Identity",
  value: "Values",
  refuse: "Refusals",
  how_i_work: "How you work",
  how_i_decide: "How you decide",
  what_im_building: "What you're building",
};

const KIND_COLOR: Record<Article["kind"], string> = {
  identity: "#e8e0d2",
  value: "#bfd4ee",
  refuse: "#f4a3a3",
  how_i_work: "#e8b96a",
  how_i_decide: "#7affcb",
  what_im_building: "#c89bff",
};

const SOURCE_HREF: Record<string, string> = {
  policy: "/policies",
  identity: "/identity",
  decision: "/decisions",
  theme: "/themes",
  trajectory: "/trajectories",
};

export function ConstitutionConsole() {
  const [rows, setRows] = useState<Constitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generateNote, setGenerateNote] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("current");
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/constitutions?status=${statusFilter}&limit=30`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      const list = (j.constitutions ?? []) as Constitution[];
      setRows(list);
      if (list.length > 0 && !list.find((c) => c.id === activeId)) {
        setActiveId(list[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, activeId]);

  useEffect(() => { void load(); }, [load]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setGenerateNote(null);
    try {
      const r = await fetch(`/api/constitutions/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "generate failed");
      const c = j.constitution as Constitution | undefined;
      if (c) {
        setGenerateNote(`v${c.version} drafted · ${(c.articles ?? []).length} articles`);
        setActiveId(c.id);
        if (statusFilter !== "current" && statusFilter !== "history") setStatusFilter("current");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setGenerating(false);
    }
  }, [load, statusFilter]);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, pinned } : r)));
    try {
      await fetch(`/api/constitutions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: pinned }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const archive = useCallback(async (id: string) => {
    try {
      await fetch(`/api/constitutions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const setCurrent = useCallback(async (id: string) => {
    try {
      await fetch(`/api/constitutions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ set_current: true }),
      });
      void load();
    } catch { void load(); }
  }, [load]);

  const onDelete = useCallback(async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (activeId === id) setActiveId(null);
    try {
      await fetch(`/api/constitutions/${id}`, { method: "DELETE" });
    } catch { void load(); }
  }, [activeId, load]);

  const active = useMemo(() => rows.find((r) => r.id === activeId) ?? rows[0] ?? null, [rows, activeId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            Your own laws
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : rows.length === 0 ? "no version yet" : `v${rows[0]?.version ?? 1} · ${rows.length} version${rows.length === 1 ? "" : "s"}`}
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
            <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>regenerate constitution</span>
            <span style={{ color: "#666", fontSize: 11 }}>
              distils your active policies, identity claims, recent decisions, themes, and trajectory
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
              {generating ? "distilling…" : "Regenerate"}
            </button>
          </div>
        </div>
        {generateNote ? <div style={{ color: "#9aa28e", fontSize: 12 }}>{generateNote}</div> : null}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["current", "history", "pinned", "archived"] as const).map((s) => (
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
          No constitution drafted yet. Add a few policies, run identity extraction, or generate a trajectory — then regenerate to distil it all into your own operating manual.
        </div>
      ) : null}

      {rows.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888", textTransform: "uppercase" }}>Versions</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {rows.map((r) => {
              const sel = active?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  style={{
                    padding: "3px 10px",
                    background: sel ? "#e8e0d2" : "transparent",
                    color: sel ? "#111" : r.is_current ? "#e8e0d2" : "#888",
                    border: "1px solid " + (sel ? "#e8e0d2" : r.is_current ? "#3a3a3a" : "#2a2a2a"),
                    fontSize: 11,
                    cursor: "pointer",
                    fontStyle: r.is_current ? "normal" : "italic",
                  }}
                  title={`v${r.version} · ${r.created_at.slice(0, 10)}`}
                >
                  v{r.version}{r.is_current ? " · current" : ""}{r.pinned ? " · pinned" : ""}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {active ? (
        <ConstitutionView
          c={active}
          onTogglePin={() => togglePin(active.id, !active.pinned)}
          onArchive={() => archive(active.id)}
          onSetCurrent={() => setCurrent(active.id)}
          onDelete={() => onDelete(active.id)}
        />
      ) : null}
    </div>
  );
}

function ConstitutionView({
  c,
  onTogglePin,
  onArchive,
  onSetCurrent,
  onDelete,
}: {
  c: Constitution;
  onTogglePin: () => void;
  onArchive: () => void;
  onSetCurrent: () => void;
  onDelete: () => void;
}) {
  const isArchived = !!c.archived_at;
  const grouped: Record<Article["kind"], Article[]> = {
    identity: [], value: [], refuse: [], how_i_work: [], how_i_decide: [], what_im_building: [],
  };
  for (const a of c.articles ?? []) {
    if (a && a.kind in grouped) grouped[a.kind].push(a);
  }
  const counts = c.source_counts ?? {};
  const countsLine = Object.entries(counts)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
    .join(" · ");

  return (
    <article
      style={{
        padding: 20,
        background: isArchived ? "#101010" : "#161616",
        borderLeft: `3px solid ${c.is_current ? "#e8e0d2" : "#444"}`,
        opacity: isArchived ? 0.6 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#888", textTransform: "uppercase" }}>
          v{c.version} · {c.created_at.slice(0, 10)}
        </span>
        {c.is_current ? (
          <span style={{ fontSize: 10, color: "#9aa28e", border: "1px solid #9aa28e", padding: "1px 6px", letterSpacing: 0.5 }}>
            CURRENT
          </span>
        ) : null}
        {c.pinned ? (
          <span style={{ fontSize: 10, color: "#e8b96a", border: "1px solid #e8b96a", padding: "1px 6px", letterSpacing: 0.5 }}>
            PINNED
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {!c.is_current && !isArchived ? (
          <button
            type="button"
            onClick={onSetCurrent}
            style={{ background: "transparent", border: "1px solid #333", color: "#9aa28e", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
          >
            Set current
          </button>
        ) : null}
        <button
          type="button"
          onClick={onTogglePin}
          style={{ background: "transparent", border: "1px solid #333", color: c.pinned ? "#e8b96a" : "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
        >
          {c.pinned ? "Unpin" : "Pin"}
        </button>
        {!isArchived ? (
          <button
            type="button"
            onClick={onArchive}
            style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
          >
            Archive
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
        >
          Delete
        </button>
      </header>

      {c.diff_summary ? (
        <div
          style={{
            padding: 12,
            background: "#0e0e0e",
            borderLeft: "2px solid #c89bff",
            fontSize: 12,
            color: "#c8c0b2",
            fontStyle: "italic",
            fontFamily: "var(--font-serif, Georgia, serif)",
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888", textTransform: "uppercase", fontStyle: "normal", marginBottom: 4 }}>
            What shifted
          </div>
          {c.diff_summary}
        </div>
      ) : null}

      {c.preamble ? (
        <div
          style={{
            padding: 14,
            background: "#0e0e0e",
            fontFamily: "var(--font-serif, Georgia, serif)",
            fontSize: 16,
            fontStyle: "italic",
            lineHeight: 1.6,
            color: "#e8e0d2",
            whiteSpace: "pre-wrap",
          }}
        >
          {c.preamble}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {KIND_ORDER.map((k) => {
          const arr = grouped[k];
          if (arr.length === 0) return null;
          return (
            <section key={k} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h3
                style={{
                  margin: 0,
                  fontFamily: "var(--font-serif, Georgia, serif)",
                  fontStyle: "italic",
                  fontSize: 18,
                  color: KIND_COLOR[k],
                  letterSpacing: 0.3,
                }}
              >
                {KIND_LABEL[k]}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {arr.map((a, i) => (
                  <ArticleCard key={`${k}-${i}`} a={a} accent={KIND_COLOR[k]} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {countsLine ? (
        <div style={{ fontSize: 10, color: "#555", letterSpacing: 0.5, paddingTop: 8, borderTop: "1px solid #2a2a2a" }}>
          distilled from: {countsLine}
        </div>
      ) : null}
    </article>
  );
}

function ArticleCard({ a, accent }: { a: Article; accent: string }) {
  const cites = Array.isArray(a.citations) ? a.citations : [];
  return (
    <div
      style={{
        padding: 12,
        background: "#0e0e0e",
        borderLeft: `2px solid ${accent}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: 15, color: "#e8e0d2", letterSpacing: 0.2 }}>
        {a.title}
      </div>
      <div
        style={{
          fontFamily: "var(--font-serif, Georgia, serif)",
          fontSize: 14,
          color: "#d8d0c2",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {a.body}
      </div>
      {cites.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {cites.map((c, i) => {
            const href = SOURCE_HREF[c.kind];
            const label = `${c.kind}#${c.id.slice(0, 6)}`;
            const chipStyle: React.CSSProperties = {
              fontSize: 10,
              padding: "1px 6px",
              border: "1px solid #2a2a2a",
              color: "#888",
              background: "#161616",
              letterSpacing: 0.3,
              textDecoration: "none",
              cursor: href ? "pointer" : "default",
            };
            return href ? (
              <a key={i} href={href} style={chipStyle} title={`${c.kind} ${c.id}`}>
                {label}
              </a>
            ) : (
              <span key={i} style={chipStyle}>{label}</span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
