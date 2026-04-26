"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

type Source = "email" | "chat" | "calendar" | "whatsapp" | "screen" | "meeting" | "note";

interface Hit {
  id: string;
  source: Source;
  external_id: string | null;
  title: string | null;
  body: string;
  participants: string[];
  occurred_at: string;
  url: string | null;
  similarity: number;
}

const SOURCE_LABEL: Record<Source, { label: string; icon: string }> = {
  email: { label: "Email", icon: "✉️" },
  chat: { label: "Chat", icon: "💬" },
  calendar: { label: "Calendar", icon: "📅" },
  whatsapp: { label: "WhatsApp", icon: "📱" },
  screen: { label: "Screen", icon: "👁️" },
  meeting: { label: "Meeting", icon: "🎤" },
  note: { label: "Note", icon: "📝" },
};

const ALL_SOURCES: Source[] = Object.keys(SOURCE_LABEL) as Source[];

export function RecallSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Set<Source>>(new Set());
  const [indexing, setIndexing] = useState(false);
  const [indexReport, setIndexReport] = useState<string | null>(null);

  const search = useCallback(async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query });
      if (sources.size) params.set("sources", [...sources].join(","));
      const r = await fetch(`/api/recall/search?${params.toString()}`);
      if (!r.ok) {
        setError(`Search failed (${r.status})`);
        return;
      }
      const d = (await r.json()) as { results: Hit[] };
      setHits(d.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, sources]);

  const runBackfill = useCallback(async () => {
    setIndexing(true);
    setIndexReport(null);
    try {
      const r = await fetch("/api/recall/backfill", { method: "POST" });
      if (!r.ok) {
        setIndexReport(`Backfill failed (${r.status})`);
        return;
      }
      const d = (await r.json()) as {
        results: { source: string; ingested: number; skipped: number; error?: string }[];
      };
      const parts = d.results.map((x) =>
        x.error ? `${x.source}: ${x.error}` : `${x.source}: +${x.ingested} (${x.skipped} skipped)`,
      );
      setIndexReport(parts.join(" · "));
    } catch (e) {
      setIndexReport(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }, []);

  const toggleSource = (s: Source) =>
    setSources((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const groupedByDay = useMemo(() => {
    if (!hits) return null;
    const g = new Map<string, Hit[]>();
    for (const h of hits) {
      const d = new Date(h.occurred_at);
      const key = d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(h);
    }
    return [...g.entries()];
  }, [hits]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Total Recall</h1>
            <p className="mt-1 text-sm text-white/60">
              Search everything — emails, calendar, chats, everywhere JARVIS remembers.
            </p>
          </div>
          <Link href="/" className="text-xs text-white/60 hover:text-white/90">
            ← back to chat
          </Link>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          className="mb-4 flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="What are you looking for? e.g. 'pricing discussion with Tom', 'Lisbon recs'"
            className="flex-1 rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm placeholder-white/30 focus:border-white/60 focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {loading ? "…" : "Search"}
          </button>
        </form>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {ALL_SOURCES.map((s) => {
            const on = sources.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleSource(s)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  on ? "border-white bg-white text-black" : "border-white/20 text-white/70 hover:border-white/40"
                }`}
              >
                {SOURCE_LABEL[s].icon} {SOURCE_LABEL[s].label}
              </button>
            );
          })}
          {sources.size > 0 && (
            <button
              onClick={() => setSources(new Set())}
              className="ml-1 text-[11px] text-white/50 hover:text-white/80"
            >
              clear
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={runBackfill}
            disabled={indexing}
            className="rounded-md border border-white/20 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/40 disabled:opacity-50"
            title="Ingest emails, calendar, and chat into the recall index."
          >
            {indexing ? "Indexing…" : "Re-index"}
          </button>
        </div>
        {indexReport && (
          <div className="mb-4 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/70">
            {indexReport}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {!hits && !loading && (
          <div className="mt-16 text-center text-sm text-white/40">
            Type anything — JARVIS will find it across your emails, calendar, and chats.
            <div className="mt-2 text-xs text-white/30">
              First time? Tap <em>Re-index</em> to pull in the last 30 days.
            </div>
          </div>
        )}

        {hits && hits.length === 0 && (
          <div className="mt-16 text-center text-sm text-white/40">
            No matches. Try different wording, or re-index.
          </div>
        )}

        {groupedByDay && groupedByDay.length > 0 && (
          <div className="space-y-6">
            {groupedByDay.map(([day, items]) => (
              <div key={day}>
                <div className="mb-2 text-xs uppercase tracking-wide text-white/40">{day}</div>
                <div className="space-y-2">
                  {items.map((h) => (
                    <Card key={h.id} hit={h} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ hit }: { hit: Hit }) {
  const { icon, label } = SOURCE_LABEL[hit.source];
  const time = new Date(hit.occurred_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <a
      href={hit.url ?? "#"}
      target={hit.url ? "_blank" : undefined}
      rel="noreferrer"
      className="block rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/30"
    >
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/50">
        <span>
          {icon} {label} · {time}
          {hit.participants.length > 0 && (
            <span className="ml-2 text-white/40">· {truncate(hit.participants.join(", "), 60)}</span>
          )}
        </span>
        <span className="text-white/30">{(hit.similarity * 100).toFixed(0)}%</span>
      </div>
      {hit.title && <div className="mb-1 truncate font-medium text-white/90">{hit.title}</div>}
      <div className="line-clamp-3 text-sm text-white/70">{hit.body}</div>
    </a>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
