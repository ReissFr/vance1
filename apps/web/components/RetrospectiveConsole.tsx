"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  kind: "win" | "reflection" | "decision" | "blocker" | "intention";
  subkind?: string | null;
  date: string;
  iso: string;
  title?: string | null;
  body: string;
  tags?: string[] | null;
  amount_cents?: number | null;
};

type Resp = {
  days: number;
  since: string;
  counts: Record<string, number>;
  items: Item[];
};

const KIND_COLOR: Record<Item["kind"], string> = {
  win: "#7affcb",
  reflection: "#e6d3e8",
  decision: "#cfdcea",
  blocker: "#f4a3a3",
  intention: "#bfd4ee",
};

const KIND_LABEL: Record<Item["kind"], string> = {
  win: "WIN",
  reflection: "REFLECTION",
  decision: "DECISION",
  blocker: "BLOCKER",
  intention: "INTENTION",
};

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

function formatDateLabel(ymd: string): string {
  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today.getTime() - 86400000);
  const yYmd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  if (ymd === todayYmd) return "Today";
  if (ymd === yYmd) return "Yesterday";
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatMoney(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  const v = Math.abs(cents) / 100;
  const formatted = v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${cents < 0 ? "-" : ""}£${formatted}`;
}

export function RetrospectiveConsole() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeKinds, setActiveKinds] = useState<Set<Item["kind"]>>(
    new Set(["win", "reflection", "decision", "blocker", "intention"]),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/retrospective?days=${days}`);
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as Resp;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [] as Item[];
    return data.items.filter((it) => activeKinds.has(it.kind));
  }, [data, activeKinds]);

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of filtered) {
      const arr = m.get(it.date) ?? [];
      arr.push(it);
      m.set(it.date, arr);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const toggleKind = (k: Item["kind"]) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const winSum = useMemo(() => {
    if (!data) return 0;
    let total = 0;
    for (const it of data.items) if (it.kind === "win" && typeof it.amount_cents === "number") total += it.amount_cents;
    return total;
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "8px 4px 80px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {RANGES.map((r) => {
            const active = days === r.days;
            return (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--bg)" : "var(--ink-2)",
                  cursor: "pointer",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        {data && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "1.4px",
              textTransform: "uppercase",
            }}
          >
            since {data.since} · {filtered.length} entries
            {winSum > 0 && ` · £${(winSum / 100).toLocaleString()} logged`}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(KIND_LABEL) as Item["kind"][]).map((k) => {
          const active = activeKinds.has(k);
          const count = data?.counts[k] ?? 0;
          const color = KIND_COLOR[k];
          return (
            <button
              key={k}
              onClick={() => toggleKind(k)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                padding: "5px 11px",
                borderRadius: 6,
                border: `1px solid ${active ? color : "var(--rule)"}`,
                background: active ? color : "transparent",
                color: active ? "#1a1a1a" : "var(--ink-3)",
                cursor: "pointer",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
              }}
            >
              {KIND_LABEL[k]} {count}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 16,
            color: "var(--ink-3)",
          }}
        >
          Synthesising the last {days} days…
        </div>
      ) : grouped.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 18,
            color: "var(--ink-3)",
          }}
        >
          {data && data.items.length > 0
            ? "No entries match the selected kinds. Toggle them on to see the timeline."
            : "Nothing logged in this window. Wins, reflections, decisions, blockers, and intentions all surface here once captured."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {grouped.map(([date, items]) => (
            <div key={date} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  paddingBottom: 4,
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--serif)",
                    fontStyle: "italic",
                    fontSize: 18,
                    color: "var(--ink)",
                    letterSpacing: "-0.2px",
                  }}
                >
                  {formatDateLabel(date)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--ink-3)",
                    letterSpacing: "1.2px",
                  }}
                >
                  {date}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--ink-3)",
                    letterSpacing: "0.6px",
                  }}
                >
                  {items.length} entr{items.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {items.map((it, i) => {
                  const color = KIND_COLOR[it.kind];
                  const money = formatMoney(it.amount_cents);
                  return (
                    <div
                      key={`${it.kind}-${it.iso}-${i}`}
                      style={{
                        display: "flex",
                        gap: 12,
                        padding: "10px 14px",
                        background: "var(--surface)",
                        border: "1px solid var(--rule)",
                        borderLeft: `3px solid ${color}`,
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          minWidth: 86,
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 9.5,
                            color: "var(--ink-2)",
                            letterSpacing: "1.4px",
                            textTransform: "uppercase",
                          }}
                        >
                          {KIND_LABEL[it.kind]}
                        </span>
                        {it.subkind && (
                          <span
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: 9,
                              color: "var(--ink-3)",
                              letterSpacing: "0.8px",
                            }}
                          >
                            {it.subkind}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                        {it.title && (
                          <div
                            style={{
                              fontFamily: "var(--sans)",
                              fontSize: 13.5,
                              fontWeight: 500,
                              color: "var(--ink)",
                              lineHeight: 1.4,
                            }}
                          >
                            {it.title}
                          </div>
                        )}
                        <div
                          style={{
                            fontFamily: "var(--sans)",
                            fontSize: 13.5,
                            color: "var(--ink-2)",
                            lineHeight: 1.45,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {it.body}
                        </div>
                        {(money || (it.tags && it.tags.length > 0)) && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                            {money && (
                              <span
                                style={{
                                  fontFamily: "var(--mono)",
                                  fontSize: 10,
                                  color: "var(--ink-2)",
                                  letterSpacing: "0.4px",
                                }}
                              >
                                {money}
                              </span>
                            )}
                            {it.tags?.map((t) => (
                              <span
                                key={t}
                                style={{
                                  fontFamily: "var(--mono)",
                                  fontSize: 9.5,
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
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
