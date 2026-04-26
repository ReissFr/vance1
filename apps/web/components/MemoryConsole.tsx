"use client";

import { useCallback, useEffect, useState } from "react";
import { useDeepLinkFocus } from "@/lib/use-deep-link-focus";

type Kind = "fact" | "preference" | "person" | "event" | "task";

interface Memory {
  id: string;
  kind: Kind;
  content: string;
  pinned?: boolean;
  created_at: string;
}

const KINDS: Kind[] = ["fact", "preference", "person", "event", "task"];

const KIND_LABEL: Record<Kind, string> = {
  fact: "Facts",
  preference: "Preferences",
  person: "People",
  event: "Events",
  task: "Tasks",
};

const KIND_COLOR: Record<Kind, string> = {
  fact: "#7a8fff",
  preference: "#c49cff",
  person: "#ffb27a",
  event: "#7affcb",
  task: "#ff9eb5",
};

export function MemoryConsole() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKind, setActiveKind] = useState<Kind | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [newKind, setNewKind] = useState<Kind>("fact");
  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { focusId } = useDeepLinkFocus("memory", { ready: !loading });

  useEffect(() => {
    const urlId = new URLSearchParams(window.location.search).get("id");
    if (urlId) setActiveKind(null);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (activeKind) params.set("kind", activeKind);
      if (debouncedQuery) params.set("q", debouncedQuery);
      const res = await fetch(`/api/memory?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as { memories: Memory[] };
      setMemories(data.memories ?? []);
    } finally {
      setLoading(false);
    }
  }, [activeKind, debouncedQuery]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    const c = newContent.trim();
    if (!c) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: newKind, content: c }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "save failed");
      }
      setNewContent("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setCreating(false);
    }
  }, [newKind, newContent, load]);

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (res.ok) {
        setMemories((m) => m.filter((x) => x.id !== id));
      }
    },
    [],
  );

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, pinned } : m)));
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
  }, []);

  const counts: Record<Kind, number> = {
    fact: 0,
    preference: 0,
    person: 0,
    event: 0,
    task: 0,
  };
  for (const m of memories) counts[m.kind] = (counts[m.kind] ?? 0) + 1;

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 960 }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: 18,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.6px",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginBottom: 10,
          }}
        >
          Teach JARVIS something
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setNewKind(k)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 11.5,
                fontFamily: "var(--sans)",
                border: "1px solid var(--rule)",
                background: newKind === k ? "var(--ink)" : "transparent",
                color: newKind === k ? "#000" : "var(--ink-2)",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="e.g. My partner Sarah prefers flat whites, not lattes."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) create();
            }}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              outline: "none",
            }}
          />
          <button
            onClick={create}
            disabled={creating || !newContent.trim()}
            style={{
              padding: "0 22px",
              borderRadius: 10,
              background: "var(--ink)",
              color: "#000",
              border: "none",
              fontFamily: "var(--sans)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              opacity: creating || !newContent.trim() ? 0.5 : 1,
            }}
          >
            {creating ? "Saving…" : "Remember"}
          </button>
        </div>
        {error && (
          <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories…"
          style={{
            width: "100%",
            padding: "10px 36px 10px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            outline: "none",
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            style={{
              position: "absolute",
              top: "50%",
              right: 8,
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "var(--ink-3)",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        <FilterPill
          label={`All · ${memories.length}`}
          active={activeKind === null}
          onClick={() => setActiveKind(null)}
        />
        {KINDS.map((k) => (
          <FilterPill
            key={k}
            label={`${KIND_LABEL[k]} · ${counts[k] ?? 0}`}
            active={activeKind === k}
            onClick={() => setActiveKind(k)}
            color={KIND_COLOR[k]}
          />
        ))}
      </div>

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : memories.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
            border: "1px dashed var(--rule)",
            borderRadius: 14,
          }}
        >
          Nothing yet. Tell me something above, or just chat — I'll remember on my own.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {memories.map((m) => (
            <MemoryRow
              key={m.id}
              m={m}
              onDelete={() => remove(m.id)}
              onTogglePin={() => togglePin(m.id, !m.pinned)}
              isFocused={focusId === m.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 11.5,
        fontFamily: "var(--sans)",
        border: `1px solid ${active ? (color ?? "var(--ink)") : "var(--rule)"}`,
        background: active ? (color ? `${color}22` : "var(--surface-2)") : "transparent",
        color: active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function MemoryRow({
  m,
  onDelete,
  onTogglePin,
  isFocused,
}: {
  m: Memory;
  onDelete: () => void;
  onTogglePin: () => void;
  isFocused?: boolean;
}) {
  const isPinned = m.pinned === true;
  return (
    <div
      data-memory-id={m.id}
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        padding: "14px 16px",
        background: isFocused
          ? "var(--indigo-soft)"
          : isPinned
            ? "rgba(251, 191, 36, 0.06)"
            : "var(--surface)",
        border: `1px solid ${
          isFocused ? "var(--indigo)" : isPinned ? "#FBBF24" : "var(--rule)"
        }`,
        borderRadius: 12,
        transition: "background 240ms ease, border-color 240ms ease",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: KIND_COLOR[m.kind],
          marginTop: 8,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--ink)",
            lineHeight: 1.55,
          }}
        >
          {m.content}
        </div>
        <div
          style={{
            marginTop: 6,
            display: "flex",
            gap: 12,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
          }}
        >
          <span style={{ color: KIND_COLOR[m.kind], textTransform: "uppercase" }}>
            {m.kind}
          </span>
          <span>
            {new Date(m.created_at).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          onClick={onTogglePin}
          title={
            isPinned
              ? "Unpin — stop always including this in context"
              : "Pin — always include this in JARVIS's context"
          }
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: isPinned ? "#FBBF24" : "var(--ink-3)",
            background: "transparent",
            border: `1px solid ${isPinned ? "#FBBF24" : "var(--rule)"}`,
            borderRadius: 6,
            padding: "4px 8px",
            cursor: "pointer",
          }}
        >
          {isPinned ? "PINNED ★" : "PIN"}
        </button>
        <button
          onClick={onDelete}
          title="Forget this"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            background: "transparent",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            padding: "4px 8px",
            cursor: "pointer",
          }}
        >
          FORGET
        </button>
      </div>
    </div>
  );
}
