"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type LegacyEntity = "commitment" | "receipt" | "subscription" | "memory" | "task";

interface LegacyHit {
  entity: LegacyEntity;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  ts: string | null;
}

interface JournalHit {
  kind: string;
  id: string;
  snippet: string;
  date: string | null;
  href: string;
  extra: Record<string, unknown>;
}

interface UnifiedHit {
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  ts: string | null;
}

const KIND_LABEL: Record<string, string> = {
  commitment: "COMMITMENT",
  receipt: "RECEIPT",
  subscription: "SUBSCRIPTION",
  memory: "MEMORY",
  task: "TASK",
  wins: "WIN",
  reflections: "REFLECTION",
  decisions: "DECISION",
  ideas: "IDEA",
  questions: "QUESTION",
  knowledge_cards: "CARD",
  saved_prompts: "PROMPT",
  routines: "ROUTINE",
  people: "PERSON",
  intentions: "INTENTION",
  standups: "STANDUP",
  reading_list: "READING",
  themes: "THEME",
  policies: "POLICY",
  predictions: "PREDICTION",
};

const KIND_COLOR: Record<string, string> = {
  commitment: "var(--indigo)",
  receipt: "#7affcb",
  subscription: "#ffb27a",
  memory: "#a78bfa",
  task: "var(--ink-2)",
  wins: "#7affcb",
  reflections: "#e6d3e8",
  decisions: "#cfdcea",
  ideas: "#bfd4ee",
  questions: "#f4c9d8",
  knowledge_cards: "#e6d3e8",
  saved_prompts: "#bfd4ee",
  routines: "#cfdcea",
  people: "#f4a3a3",
  intentions: "#bfd4ee",
  standups: "#cfdcea",
  reading_list: "#a78bfa",
  themes: "#bfd4ee",
  policies: "#7affcb",
  predictions: "#ffb27a",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 14) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

type Mode = "text" | "tag";

export function SearchConsole() {
  const [mode, setMode] = useState<Mode>("text");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<UnifiedHit[]>([]);
  const [kindFilter, setKindFilter] = useState<string | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const url = new URLSearchParams(window.location.search);
    const urlQ = url.get("q");
    const urlTag = url.get("tag");
    if (urlTag) {
      setMode("tag");
      setQuery(urlTag);
      setDebounced(urlTag);
    } else if (urlQ) {
      setQuery(urlQ);
      setDebounced(urlQ);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced || (mode === "text" && debounced.length < 2)) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const journalUrl =
      mode === "text"
        ? `/api/search/journal?q=${encodeURIComponent(debounced)}`
        : `/api/search/journal?tag=${encodeURIComponent(debounced)}`;
    const legacyUrl =
      mode === "text" ? `/api/search/all?q=${encodeURIComponent(debounced)}` : null;

    const promises: Array<Promise<unknown>> = [
      fetch(journalUrl, { cache: "no-store" }).then((r) => r.json() as Promise<{ hits: JournalHit[] }>),
    ];
    if (legacyUrl) {
      promises.push(
        fetch(legacyUrl, { cache: "no-store" }).then((r) => r.json() as Promise<{ hits: LegacyHit[] }>),
      );
    }

    Promise.all(promises)
      .then((results) => {
        if (cancelled) return;
        const journalRes = results[0] as { hits: JournalHit[] };
        const legacyRes = results.length > 1 ? (results[1] as { hits: LegacyHit[] }) : { hits: [] };

        const merged: UnifiedHit[] = [];
        for (const h of journalRes.hits ?? []) {
          merged.push({
            kind: h.kind,
            id: h.id,
            title: h.snippet,
            subtitle: subtitleForJournal(h),
            href: h.href,
            ts: h.date,
          });
        }
        for (const h of legacyRes.hits ?? []) {
          merged.push({
            kind: h.entity,
            id: h.id,
            title: h.title,
            subtitle: h.subtitle,
            href: h.href,
            ts: h.ts,
          });
        }
        merged.sort((a, b) => {
          const ta = a.ts ? Date.parse(a.ts) : 0;
          const tb = b.ts ? Date.parse(b.ts) : 0;
          return tb - ta;
        });
        setHits(merged);
      })
      .catch(() => {
        if (!cancelled) setHits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, mode]);

  const filtered = useMemo(
    () => (kindFilter === "all" ? hits : hits.filter((h) => h.kind === kindFilter)),
    [hits, kindFilter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const h of hits) c[h.kind] = (c[h.kind] ?? 0) + 1;
    return c;
  }, [hits]);

  return (
    <div style={{ padding: "24px 32px 48px", maxWidth: 980 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setMode("text")}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            padding: "6px 14px",
            borderRadius: 5,
            border: `1px solid ${mode === "text" ? "var(--indigo)" : "var(--rule)"}`,
            background: mode === "text" ? "var(--indigo)" : "transparent",
            color: mode === "text" ? "var(--bg)" : "var(--ink-3)",
            cursor: "pointer",
          }}
        >
          Text
        </button>
        <button
          onClick={() => setMode("tag")}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            padding: "6px 14px",
            borderRadius: 5,
            border: `1px solid ${mode === "tag" ? "var(--indigo)" : "var(--rule)"}`,
            background: mode === "tag" ? "var(--indigo)" : "transparent",
            color: mode === "tag" ? "var(--bg)" : "var(--ink-3)",
            cursor: "pointer",
          }}
        >
          Tag
        </button>
      </div>

      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          mode === "text"
            ? "Search across every journal layer + commitments, receipts, subs, tasks, memories…"
            : "Exact tag (e.g. lisbon)"
        }
        style={{
          width: "100%",
          padding: "14px 18px",
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 12,
          color: "var(--ink)",
          fontFamily: mode === "tag" ? "var(--mono)" : "var(--sans)",
          fontSize: 15,
          outline: "none",
        }}
      />

      {debounced && hits.length > 0 && (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <Pill
            label={`All · ${hits.length}`}
            active={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
          />
          {Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <Pill
                key={k}
                label={`${(KIND_LABEL[k] ?? k).toLowerCase()} · ${n}`}
                active={kindFilter === k}
                onClick={() => setKindFilter(k)}
                color={KIND_COLOR[k] ?? "var(--ink-2)"}
              />
            ))}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {!debounced ? (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              border: "1px dashed var(--rule)",
              borderRadius: 12,
            }}
          >
            {mode === "text"
              ? "Fuzzy substring across 20 journal + ops sources."
              : "Find every entry tagged with a specific word, across all sources that have tags."}
          </div>
        ) : loading ? (
          <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Searching…</div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              padding: 36,
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              border: "1px dashed var(--rule)",
              borderRadius: 12,
            }}
          >
            Nothing matches <em>{debounced}</em>. {mode === "text" ? "Try /recall for semantic search across email, chat, meetings." : "Tags are exact + case-sensitive."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((h) => (
              <Link
                key={`${h.kind}-${h.id}`}
                href={h.href}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "baseline",
                  padding: "12px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--rule)",
                  borderLeft: `3px solid ${KIND_COLOR[h.kind] ?? "var(--ink-2)"}`,
                  borderRadius: 10,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div
                  style={{
                    width: 110,
                    flexShrink: 0,
                    fontFamily: "var(--mono)",
                    fontSize: 9.5,
                    letterSpacing: "1.2px",
                    color: KIND_COLOR[h.kind] ?? "var(--ink-2)",
                  }}
                >
                  {KIND_LABEL[h.kind] ?? h.kind.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--sans)",
                      fontSize: 13.5,
                      color: "var(--ink)",
                      lineHeight: 1.45,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h.title}
                  </div>
                  {h.subtitle && (
                    <div
                      style={{
                        marginTop: 3,
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "var(--ink-3)",
                        letterSpacing: "0.4px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h.subtitle}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--ink-3)",
                    letterSpacing: "0.4px",
                    flexShrink: 0,
                  }}
                >
                  {formatRelative(h.ts)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function subtitleForJournal(h: JournalHit): string | null {
  const e = h.extra ?? {};
  const parts: string[] = [];
  if (typeof e.subkind === "string") parts.push(e.subkind);
  if (typeof e.theme_kind === "string") parts.push(e.theme_kind);
  if (typeof e.category === "string") parts.push(e.category);
  if (typeof e.status === "string") parts.push(e.status);
  if (typeof e.priority === "number") parts.push(`P${e.priority}`);
  if (typeof e.confidence === "number") parts.push(`${e.confidence}%`);
  if (Array.isArray(e.tags) && e.tags.length > 0) {
    parts.push(e.tags.map((t) => `#${t}`).join(" "));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function Pill({
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
        padding: "6px 12px",
        borderRadius: 999,
        fontFamily: "var(--sans)",
        fontSize: 11.5,
        border: `1px solid ${active ? (color ?? "var(--ink)") : "var(--rule)"}`,
        background: active ? (color ? `${color}22` : "var(--surface-2)") : "transparent",
        color: active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: "0.6px",
      }}
    >
      {label}
    </button>
  );
}
