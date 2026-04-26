"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Kind = "am" | "value" | "refuse" | "becoming" | "aspire";
type Status = "active" | "dormant" | "contradicted" | "retired";

type Claim = {
  id: string;
  kind: Kind;
  statement: string;
  normalized_key: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  source_refs: Array<{ kind: string; id: string; snippet: string }>;
  status: Status;
  contradiction_note: string | null;
  user_note: string | null;
  pinned: boolean;
};

const KIND_ORDER: Kind[] = ["am", "value", "refuse", "becoming", "aspire"];

const KIND_LABEL: Record<Kind, string> = {
  am: "I am",
  value: "I value",
  refuse: "I refuse",
  becoming: "I'm becoming",
  aspire: "I aspire",
};

const KIND_COLOR: Record<Kind, string> = {
  am: "#e8e0d2",
  value: "#bfd4ee",
  refuse: "#f4a3a3",
  becoming: "#e8b96a",
  aspire: "#7affcb",
};

const STATUS_COLOR: Record<Status, string> = {
  active: "#9aa28e",
  dormant: "#7a7466",
  contradicted: "#f4a3a3",
  retired: "#555",
};

const SOURCE_HREF: Record<string, string> = {
  reflection: "/reflections",
  decision: "/decisions",
  theme: "/themes",
  intention: "/intentions",
  win: "/wins",
};

const WINDOWS: Array<{ value: number; label: string }> = [
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6mo" },
  { value: 365, label: "1yr" },
];

export function IdentityConsole() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extractWindow, setExtractWindow] = useState<number>(90);
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"default" | Status | "all">("default");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/identity?status=${statusFilter}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setClaims((j.claims ?? []) as Claim[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const extract = useCallback(async () => {
    setExtracting(true);
    setError(null);
    setExtractNote(null);
    try {
      const r = await fetch(`/api/identity/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: extractWindow }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "extract failed");
      setExtractNote(`extracted ${j.extracted ?? 0} new · merged ${j.merged ?? 0} · ${j.marked_dormant ?? 0} now dormant`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "extract failed");
    } finally {
      setExtracting(false);
    }
  }, [extractWindow, load]);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setClaims((prev) => prev.map((c) => (c.id === id ? { ...c, pinned } : c)));
    try {
      await fetch(`/api/identity/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: pinned }) });
      void load();
    } catch { void load(); }
  }, [load]);

  const setStatus = useCallback(async (id: string, status: Status) => {
    setClaims((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    try {
      await fetch(`/api/identity/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      void load();
    } catch { void load(); }
  }, [load]);

  const onDelete = useCallback(async (id: string) => {
    setClaims((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch(`/api/identity/${id}`, { method: "DELETE" });
    } catch { void load(); }
  }, [load]);

  const grouped = useMemo(() => {
    const out: Record<Kind, Claim[]> = { am: [], value: [], refuse: [], becoming: [], aspire: [] };
    for (const c of claims) out[c.kind].push(c);
    return out;
  }, [claims]);

  const totalCount = claims.length;
  const activeCount = claims.filter((c) => c.status === "active").length;
  const dormantCount = claims.filter((c) => c.status === "dormant").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            Who you are, in your own words
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${totalCount} claim${totalCount === 1 ? "" : "s"} · ${activeCount} active · ${dormantCount} dormant`}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid #2a2a2a", background: "#1a1a1a" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>extract from</span>
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setExtractWindow(w.value)}
                style={{
                  padding: "3px 9px",
                  background: extractWindow === w.value ? "#e8e0d2" : "transparent",
                  color: extractWindow === w.value ? "#111" : "#aaa",
                  border: "1px solid " + (extractWindow === w.value ? "#e8e0d2" : "#333"),
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {w.label}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              disabled={extracting}
              onClick={extract}
              style={{
                padding: "5px 14px",
                background: extracting ? "#444" : "#e8e0d2",
                color: extracting ? "#888" : "#111",
                border: "1px solid #e8e0d2",
                fontSize: 12,
                cursor: extracting ? "not-allowed" : "pointer",
              }}
            >
              {extracting ? "extracting…" : "Run extraction"}
            </button>
          </div>
          <div style={{ color: "#666", fontSize: 11 }}>
            Re-running merges into existing claims (occurrences bumps, last-seen updates). Claims unseen for 60+ days drift to dormant.
          </div>
        </div>
        {extractNote ? <div style={{ color: "#9aa28e", fontSize: 12 }}>{extractNote}</div> : null}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["default", "active", "dormant", "contradicted", "retired", "all"] as const).map((s) => (
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
              {s === "default" ? "not retired" : s}
            </button>
          ))}
        </div>
      </header>

      {error ? <div style={{ color: "#f4a3a3" }}>{error}</div> : null}

      {!loading && totalCount === 0 ? (
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
          No identity claims yet. Run an extraction to surface the I-am, I-value, I-refuse, I&rsquo;m-becoming, I-aspire statements you&rsquo;ve actually written.
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {KIND_ORDER.map((k) => {
          const items = grouped[k];
          if (items.length === 0) return null;
          return (
            <section key={k} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{
                margin: 0,
                fontFamily: "var(--font-serif, Georgia, serif)",
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: 18,
                color: KIND_COLOR[k],
                letterSpacing: 0.3,
              }}>
                {KIND_LABEL[k]} · <span style={{ color: "#666", fontSize: 12 }}>{items.length}</span>
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((c) => (
                  <ClaimCard
                    key={c.id}
                    claim={c}
                    onTogglePin={() => togglePin(c.id, !c.pinned)}
                    onSetStatus={(s) => setStatus(c.id, s)}
                    onDelete={() => onDelete(c.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ClaimCard({
  claim,
  onTogglePin,
  onSetStatus,
  onDelete,
}: {
  claim: Claim;
  onTogglePin: () => void;
  onSetStatus: (s: Status) => void;
  onDelete: () => void;
}) {
  const accent = KIND_COLOR[claim.kind];
  const statusColor = STATUS_COLOR[claim.status];
  const stale = claim.status === "dormant" || claim.status === "retired";
  const refs = Array.isArray(claim.source_refs) ? claim.source_refs : [];
  return (
    <article
      style={{
        padding: 12,
        background: stale ? "#101010" : "#161616",
        borderLeft: `3px solid ${accent}`,
        opacity: claim.status === "retired" ? 0.5 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#e8e0d2", fontSize: 15, lineHeight: 1.4, flex: 1, minWidth: 240 }}>
          {claim.statement}
        </span>
        {claim.pinned ? (
          <span style={{ fontSize: 10, color: "#e8b96a", border: "1px solid #e8b96a", padding: "1px 6px", letterSpacing: 0.5 }}>PINNED</span>
        ) : null}
        <span style={{ fontSize: 10, color: statusColor, border: `1px solid ${statusColor}`, padding: "1px 6px", letterSpacing: 0.5, textTransform: "uppercase" }}>
          {claim.status}
        </span>
        <span style={{ fontSize: 11, color: "#666" }}>
          ×{claim.occurrences} · last {claim.last_seen_at.slice(0, 10)}
        </span>
      </div>

      {claim.contradiction_note ? (
        <div style={{ fontSize: 12, color: "#f4a3a3", fontStyle: "italic" }}>contradiction: {claim.contradiction_note}</div>
      ) : null}

      {refs.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {refs.slice(0, 6).map((r, i) => {
            const href = SOURCE_HREF[r.kind] ?? "/search";
            return (
              <a
                key={`${r.kind}-${r.id}-${i}`}
                href={href}
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  border: "1px solid #2a2a2a",
                  color: "#888",
                  textDecoration: "none",
                  background: "#0e0e0e",
                  letterSpacing: 0.3,
                }}
                title={r.snippet}
              >
                {r.kind}{r.snippet ? ` · ${r.snippet.slice(0, 40)}${r.snippet.length > 40 ? "…" : ""}` : ""}
              </a>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button type="button" onClick={onTogglePin} style={{ background: "transparent", border: "1px solid #333", color: claim.pinned ? "#e8b96a" : "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
          {claim.pinned ? "Unpin" : "Pin"}
        </button>
        {claim.status !== "active" ? (
          <button type="button" onClick={() => onSetStatus("active")} style={{ background: "transparent", border: "1px solid #333", color: "#9aa28e", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
            Mark active
          </button>
        ) : null}
        {claim.status !== "contradicted" ? (
          <button type="button" onClick={() => onSetStatus("contradicted")} style={{ background: "transparent", border: "1px solid #333", color: "#f4a3a3", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
            Mark contradicted
          </button>
        ) : null}
        {claim.status !== "retired" ? (
          <button type="button" onClick={() => onSetStatus("retired")} style={{ background: "transparent", border: "1px solid #333", color: "#888", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
            Retire
          </button>
        ) : null}
        <button type="button" onClick={onDelete} style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
          Delete
        </button>
      </div>
    </article>
  );
}
