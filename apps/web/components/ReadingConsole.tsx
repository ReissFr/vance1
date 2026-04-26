"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ReadingItem = {
  id: string;
  url: string;
  title: string | null;
  source_domain: string | null;
  summary: string | null;
  note: string | null;
  saved_at: string;
  read_at: string | null;
  archived_at: string | null;
  fetch_error: string | null;
};

type Filter = "unread" | "read" | "archived" | "all";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

export function ReadingConsole() {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<Filter>("unread");
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/reading?filter=${f}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { items: ReadingItem[]; unread_count: number };
      setItems(j.items ?? []);
      setUnreadCount(j.unread_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const save = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/reading", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setUrlInput("");
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [urlInput, filter, load]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== id) return it;
          const next = { ...it };
          if (typeof body.read === "boolean") {
            next.read_at = body.read ? new Date().toISOString() : null;
          }
          if (typeof body.archived === "boolean") {
            next.archived_at = body.archived ? new Date().toISOString() : null;
          }
          return next;
        }),
      );
      try {
        await fetch(`/api/reading/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (filter !== "all") {
          // Row may have left the current filter bucket — refresh.
          void load(filter);
        } else {
          // Just refresh unread count.
          const r = await fetch("/api/reading?filter=unread", { cache: "no-store" });
          const j = (await r.json().catch(() => ({}))) as { unread_count?: number };
          setUnreadCount(j.unread_count ?? 0);
        }
      } catch {
        void load(filter);
      }
    },
    [filter, load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Remove this from your reading list?")) return;
      setItems((prev) => prev.filter((it) => it.id !== id));
      try {
        await fetch(`/api/reading/${id}`, { method: "DELETE" });
      } finally {
        void load(filter);
      }
    },
    [filter, load],
  );

  const filterOptions: { id: Filter; label: string }[] = useMemo(
    () => [
      { id: "unread", label: "Unread" },
      { id: "read", label: "Read" },
      { id: "archived", label: "Archived" },
      { id: "all", label: "All" },
    ],
    [],
  );

  return (
    <div
      style={{
        padding: "28px 32px 48px",
        maxWidth: 860,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div
        style={{
          padding: "20px 22px",
          borderRadius: 14,
          background: "var(--panel)",
          border: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginBottom: 10,
          }}
        >
          Save a link
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste a URL — I'll fetch it and summarize"
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--bg)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--sans)",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            disabled={saving || !urlInput.trim()}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              background: saving ? "var(--rule)" : "var(--ink)",
              color: saving ? "var(--ink-3)" : "#000",
              border: "none",
              fontFamily: "var(--sans)",
              fontSize: 13,
              fontWeight: 500,
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
        {error && (
          <div
            style={{
              marginTop: 10,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "#ff6b6b",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {filterOptions.map((opt) => {
          const active = filter === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                background: active ? "var(--ink)" : "transparent",
                color: active ? "#000" : "var(--ink-2)",
                border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {opt.label}
              {opt.id === "unread" && unreadCount > 0 && (
                <span style={{ marginLeft: 6, color: active ? "#000" : "var(--indigo)" }}>
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 18,
            color: "var(--ink-3)",
            border: "1px dashed var(--rule)",
            borderRadius: 14,
          }}
        >
          {filter === "unread"
            ? "Nothing in the queue. Paste a URL above — I'll summarize it."
            : filter === "read"
            ? "Nothing marked read yet."
            : filter === "archived"
            ? "No archived items."
            : "Nothing here yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map((it) => (
            <Card key={it.id} item={it} onPatch={patch} onRemove={remove} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({
  item,
  onPatch,
  onRemove,
}: {
  item: ReadingItem;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const isRead = !!item.read_at;
  const isArchived = !!item.archived_at;
  return (
    <div
      style={{
        padding: "18px 20px",
        borderRadius: 14,
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        opacity: isArchived ? 0.6 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              fontFamily: "var(--serif)",
              fontSize: 18,
              color: "var(--ink)",
              textDecoration: "none",
              marginBottom: 4,
              wordBreak: "break-word",
              textDecorationLine: isRead ? "line-through" : "none",
              textDecorationColor: "var(--ink-3)",
            }}
          >
            {item.title || item.url}
          </a>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: 0.4,
            }}
          >
            {item.source_domain && <span>{item.source_domain}</span>}
            <span>·</span>
            <span>{timeAgo(item.saved_at)}</span>
            {isRead && (
              <>
                <span>·</span>
                <span style={{ color: "#7affcb" }}>read</span>
              </>
            )}
          </div>
        </div>
      </div>

      {item.summary ? (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--ink-2)",
          }}
        >
          {item.summary}
        </div>
      ) : item.fetch_error ? (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--bg)",
            border: "1px dashed var(--rule)",
          }}
        >
          Couldn&rsquo;t auto-summarize: {item.fetch_error}
        </div>
      ) : null}

      {item.note && (
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 13,
            color: "var(--ink-3)",
            borderLeft: "2px solid var(--rule)",
            paddingLeft: 12,
          }}
        >
          {item.note}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <ActionButton
          label={isRead ? "Mark unread" : "Mark read"}
          onClick={() => void onPatch(item.id, { read: !isRead })}
        />
        <ActionButton
          label={isArchived ? "Unarchive" : "Archive"}
          onClick={() => void onPatch(item.id, { archived: !isArchived })}
        />
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            background: "transparent",
            color: "var(--ink-2)",
            border: "1px solid var(--rule)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          Open
        </a>
        <ActionButton label="Remove" onClick={() => void onRemove(item.id)} danger />
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        background: "transparent",
        color: danger ? "#ff6b6b" : "var(--ink-2)",
        border: `1px solid ${danger ? "rgba(255,107,107,0.35)" : "var(--rule)"}`,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
