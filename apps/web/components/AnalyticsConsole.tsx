"use client";

import { useCallback, useEffect, useState } from "react";

interface Summary {
  totals: { events: number; sessions: number; pageviews: number };
  topEvents: { event: string; count: number }[];
  topPaths: { path: string; count: number }[];
  sources: { source: string; count: number }[];
  perDay: { date: string; count: number }[];
  recent: {
    event: string;
    path: string | null;
    session_id: string | null;
    source: string | null;
    created_at: string;
  }[];
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AnalyticsConsole() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/summary?days=${days}`, { cache: "no-store" });
      const data = (await res.json()) as Summary;
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDay = summary ? Math.max(1, ...summary.perDay.map((d) => d.count)) : 1;

  return (
    <div style={{ padding: "24px 32px 48px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[1, 7, 14, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              background: days === d ? "var(--surface-2)" : "transparent",
              color: days === d ? "var(--ink)" : "var(--ink-3)",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              padding: "5px 12px",
              letterSpacing: "0.6px",
              cursor: "pointer",
            }}
          >
            {d}D
          </button>
        ))}
      </div>

      {loading || !summary ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 22, flexWrap: "wrap" }}>
            <Stat label="EVENTS" value={summary.totals.events} />
            <Stat label="SESSIONS" value={summary.totals.sessions} />
            <Stat label="PAGEVIEWS" value={summary.totals.pageviews} />
          </div>

          <Section title="TIMELINE">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
              {summary.perDay.map((d) => (
                <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div
                    style={{
                      width: "100%",
                      height: `${(d.count / maxDay) * 100}%`,
                      minHeight: 2,
                      background: "var(--indigo)",
                      borderRadius: 2,
                      opacity: d.count ? 1 : 0.2,
                    }}
                    title={`${d.date}: ${d.count}`}
                  />
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9,
                      color: "var(--ink-3)",
                      letterSpacing: "0.4px",
                    }}
                  >
                    {d.date.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 24 }}>
            <Section title="TOP EVENTS">
              <RankedList items={summary.topEvents.map((e) => ({ label: e.event, count: e.count }))} />
            </Section>
            <Section title="TOP PATHS">
              <RankedList items={summary.topPaths.map((p) => ({ label: p.path, count: p.count }))} />
            </Section>
          </div>

          {summary.sources.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <Section title="SOURCES">
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {summary.sources.map((s) => (
                    <span
                      key={s.source}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--ink-2)",
                        border: "1px solid var(--rule)",
                        borderRadius: 999,
                        padding: "5px 12px",
                      }}
                    >
                      {s.source.toUpperCase()} · {s.count}
                    </span>
                  ))}
                </div>
              </Section>
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <Section title="RECENT">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {summary.recent.map((e, i) => (
                  <div
                    key={`${e.created_at}-${i}`}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "6px 0",
                      borderBottom: "1px solid var(--rule-soft)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--ink-2)",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "var(--ink-3)", width: 70 }}>{formatRelative(e.created_at)}</span>
                    <span style={{ color: "var(--ink)", minWidth: 120 }}>{e.event}</span>
                    <span style={{ color: "var(--ink-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.path ?? ""}
                    </span>
                    {e.source && (
                      <span style={{ color: "var(--ink-3)", letterSpacing: "0.4px" }}>{e.source.toUpperCase()}</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 10,
        padding: "14px 18px",
        minWidth: 140,
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--ink-3)",
          letterSpacing: "0.6px",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 28,
          fontStyle: "italic",
          color: "var(--ink)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          letterSpacing: "0.6px",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function RankedList({ items }: { items: { label: string; count: number }[] }) {
  if (items.length === 0) {
    return <div style={{ color: "var(--ink-3)", fontSize: 12, fontStyle: "italic" }}>None yet.</div>;
  }
  const max = Math.max(...items.map((i) => i.count));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((i) => (
        <div
          key={i.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--sans)",
            fontSize: 12.5,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--ink)",
            }}
          >
            {i.label}
          </div>
          <div
            style={{
              width: 80,
              height: 4,
              background: "var(--rule)",
              borderRadius: 2,
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: `${(i.count / max) * 100}%`,
                height: "100%",
                background: "var(--indigo)",
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
              width: 36,
              textAlign: "right",
            }}
          >
            {i.count}
          </div>
        </div>
      ))}
    </div>
  );
}
