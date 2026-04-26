"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Card = {
  id: string;
  claim: string;
  source: string | null;
  url: string | null;
  kind: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

const KINDS = [
  "stat",
  "quote",
  "principle",
  "playbook",
  "anecdote",
  "definition",
  "other",
] as const;

const KIND_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "principle", label: "Principles" },
  { id: "stat", label: "Stats" },
  { id: "quote", label: "Quotes" },
  { id: "playbook", label: "Playbooks" },
  { id: "anecdote", label: "Anecdotes" },
  { id: "definition", label: "Definitions" },
  { id: "other", label: "Other" },
];

const KIND_COLOUR: Record<string, string> = {
  principle: "#bfd4ee",
  stat: "#7affcb",
  quote: "#f4c9d8",
  playbook: "#e6d3e8",
  anecdote: "#f4a3a3",
  definition: "#cfdcea",
  other: "var(--ink-3)",
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function KnowledgeCardsConsole() {
  const [rows, setRows] = useState<Card[]>([]);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [claim, setClaim] = useState("");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<string>("principle");
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (kindFilter !== "all") params.set("kind", kindFilter);
    const url = params.toString() ? `/api/knowledge-cards?${params.toString()}` : "/api/knowledge-cards";
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Card[] };
    setRows(json.rows ?? []);
  }, [search, kindFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = claim.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      const tags = tagText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/api/knowledge-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claim: c,
          source: source.trim() || null,
          url: url.trim() || null,
          kind,
          tags,
        }),
      });
      if (res.ok) {
        setClaim("");
        setSource("");
        setUrl("");
        setKind("principle");
        setTagText("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, payload: Record<string, unknown>) => {
    await fetch(`/api/knowledge-cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/knowledge-cards/${id}`, { method: "DELETE" });
    await load();
  };

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "8px 4px 80px" }}>
      <form
        onSubmit={submit}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "18px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.6px",
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          New card — what's worth keeping?
        </div>
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder='"The most contrarian thing of all is not to oppose the crowd but to think for yourself." — Peter Thiel'
          rows={3}
          style={{
            fontFamily: "var(--serif)",
            fontSize: 15,
            padding: "10px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--ink)",
            outline: "none",
            lineHeight: 1.5,
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {KINDS.map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setKind(k)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--rule)",
                background: kind === k ? KIND_COLOUR[k] : "transparent",
                color: kind === k ? "var(--bg)" : "var(--ink-2)",
                cursor: "pointer",
                letterSpacing: "0.4px",
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Source — book / person / paper / talk"
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optional)"
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="tags, comma, separated"
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
          />
          <button
            type="submit"
            disabled={!claim.trim() || busy}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: claim.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
              color: claim.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
              cursor: claim.trim() && !busy ? "pointer" : "default",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            Keep
          </button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by claim or source"
          style={{
            flex: 1,
            minWidth: 200,
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            padding: "8px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        {tagCounts.length > 0 && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "1.4px" }}>
            {rows.length} cards · {tagCounts.length} tags
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {KIND_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setKindFilter(f.id)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 999,
              border: "1px solid var(--rule)",
              background:
                kindFilter === f.id
                  ? f.id === "all"
                    ? "var(--ink)"
                    : (KIND_COLOUR[f.id] ?? "var(--ink)")
                  : "transparent",
              color: kindFilter === f.id ? "var(--bg)" : "var(--ink-2)",
              cursor: "pointer",
              letterSpacing: "0.4px",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--ink-3)",
          }}
        >
          No cards yet. The thought worth quoting tomorrow is the thought worth keeping today.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((c) => {
            const editing = editingId === c.id;
            const colour = KIND_COLOUR[c.kind] ?? "var(--ink-3)";
            return (
              <div
                key={c.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--rule)",
                  borderLeft: `3px solid ${colour}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {editing ? (
                  <EditForm
                    card={c}
                    onCancel={() => setEditingId(null)}
                    onSave={async (payload) => {
                      await patch(c.id, payload);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <div
                      style={{
                        fontFamily: "var(--serif)",
                        fontSize: 16,
                        color: "var(--ink)",
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {c.claim}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 4,
                          border: "1px solid var(--rule)",
                          color: colour,
                          letterSpacing: "0.3px",
                        }}
                      >
                        {c.kind}
                      </span>
                      {c.source && (
                        <span
                          style={{
                            fontFamily: "var(--sans)",
                            fontSize: 13,
                            color: "var(--ink-2)",
                            fontStyle: "italic",
                          }}
                        >
                          — {c.source}
                        </span>
                      )}
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10.5,
                            color: "var(--indigo)",
                            letterSpacing: "0.3px",
                            textDecoration: "none",
                          }}
                        >
                          ↗ source
                        </a>
                      )}
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            border: "1px solid var(--rule)",
                            color: "var(--ink-3)",
                            letterSpacing: "0.3px",
                          }}
                        >
                          {t}
                        </span>
                      ))}
                      <span
                        style={{
                          marginLeft: "auto",
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          color: "var(--ink-3)",
                          letterSpacing: "0.4px",
                        }}
                      >
                        {relTime(c.created_at)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setEditingId(c.id)}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          padding: "3px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--rule)",
                          background: "transparent",
                          color: "var(--ink-2)",
                          cursor: "pointer",
                          letterSpacing: "0.4px",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          background: "transparent",
                          border: "none",
                          color: "var(--ink-3)",
                          cursor: "pointer",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditForm({
  card,
  onCancel,
  onSave,
}: {
  card: Card;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [claim, setClaim] = useState(card.claim);
  const [source, setSource] = useState(card.source ?? "");
  const [url, setUrl] = useState(card.url ?? "");
  const [kind, setKind] = useState<string>(card.kind);
  const [tagText, setTagText] = useState(card.tags.join(", "));
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={claim}
        onChange={(e) => setClaim(e.target.value)}
        rows={3}
        style={{
          fontFamily: "var(--serif)",
          fontSize: 15,
          padding: "8px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {KINDS.map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setKind(k)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: 999,
              border: "1px solid var(--rule)",
              background: kind === k ? (KIND_COLOUR[k] ?? "var(--ink)") : "transparent",
              color: kind === k ? "var(--bg)" : "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <input
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="source"
        style={inputStyle}
      />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="url" style={inputStyle} />
      <input
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        placeholder="tags, comma, separated"
        style={inputStyle}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid var(--rule)",
            background: "transparent",
            color: "var(--ink-3)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          disabled={busy || !claim.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const tags = tagText
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              await onSave({
                claim: claim.trim(),
                source: source.trim() || null,
                url: url.trim() || null,
                kind,
                tags,
              });
            } finally {
              setBusy(false);
            }
          }}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid var(--rule)",
            background: "var(--ink)",
            color: "var(--bg)",
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 13,
  padding: "7px 10px",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--ink)",
  outline: "none",
};
