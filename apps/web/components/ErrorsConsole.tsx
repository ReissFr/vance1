"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface ErrorEvent {
  id: string;
  user_id: string | null;
  route: string | null;
  method: string | null;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  severity: "error" | "warn" | "info";
  sentry_forwarded: boolean;
  created_at: string;
}

interface TopRoute {
  route: string;
  count: number;
}

const SEVERITY_COLOR: Record<string, string> = {
  error: "#F87171",
  warn: "#FBBF24",
  info: "#93C5FD",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ErrorsConsole() {
  const [list, setList] = useState<ErrorEvent[]>([]);
  const [topRoutes, setTopRoutes] = useState<TopRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [severity, setSeverity] = useState<string>("");
  const [routeFilter, setRouteFilter] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (severity) params.set("severity", severity);
      if (routeFilter) params.set("route", routeFilter);
      const res = await fetch(`/api/errors?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as { errors: ErrorEvent[]; topRoutes: TopRoute[] };
      setList(data.errors ?? []);
      setTopRoutes(data.topRoutes ?? []);
    } finally {
      setLoading(false);
    }
  }, [severity, routeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const severityCounts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0 };
    for (const e of list) c[e.severity]++;
    return c;
  }, [list]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ padding: "24px 32px 48px" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <StatCard label="ERRORS" value={severityCounts.error} color={SEVERITY_COLOR.error!} />
        <StatCard label="WARNINGS" value={severityCounts.warn} color={SEVERITY_COLOR.warn!} />
        <StatCard label="INFO" value={severityCounts.info} color={SEVERITY_COLOR.info!} />
        <StatCard label="SENTRY" value={list.filter((e) => e.sentry_forwarded).length} color="var(--indigo)" />
      </div>

      {topRoutes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.6px",
              marginBottom: 8,
            }}
          >
            TOP ROUTES · LAST 7 DAYS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {topRoutes.map((r) => (
              <button
                key={r.route}
                onClick={() => setRouteFilter(routeFilter === r.route ? "" : r.route)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  background: routeFilter === r.route ? "var(--indigo-soft)" : "transparent",
                  color: routeFilter === r.route ? "var(--ink)" : "var(--ink-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 999,
                  padding: "5px 10px",
                  cursor: "pointer",
                }}
              >
                {r.route} · {r.count}
              </button>
            ))}
            {routeFilter && (
              <button
                onClick={() => setRouteFilter("")}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  background: "transparent",
                  color: "var(--ink-3)",
                  border: "1px dashed var(--rule)",
                  borderRadius: 999,
                  padding: "5px 10px",
                  cursor: "pointer",
                }}
              >
                CLEAR FILTER
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["", "error", "warn", "info"] as const).map((s) => (
          <button
            key={s || "all"}
            onClick={() => setSeverity(s)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              background: severity === s ? "var(--surface-2)" : "transparent",
              color: severity === s ? "var(--ink)" : "var(--ink-3)",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              padding: "5px 10px",
              letterSpacing: "0.6px",
              cursor: "pointer",
            }}
          >
            {s ? s.toUpperCase() : "ALL"}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : list.length === 0 ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 24, textAlign: "center" }}>
          No errors logged. Healthy system.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "var(--rule)" }}>
          {list.map((e) => {
            const isOpen = expanded.has(e.id);
            return (
              <div key={e.id} style={{ background: "var(--bg)" }}>
                <button
                  onClick={() => toggleExpand(e.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    background: "transparent",
                    border: "none",
                    color: "var(--ink)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      marginTop: 4,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: SEVERITY_COLOR[e.severity],
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "var(--sans)",
                        fontSize: 13,
                        color: "var(--ink)",
                        marginBottom: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {e.message}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "var(--ink-3)",
                        letterSpacing: "0.4px",
                        display: "flex",
                        gap: 10,
                      }}
                    >
                      <span>{e.route ?? "(no route)"}</span>
                      {e.method && <span>{e.method}</span>}
                      <span>{formatTime(e.created_at)}</span>
                      {e.sentry_forwarded && <span style={{ color: "var(--indigo)" }}>SENTRY ✓</span>}
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div
                    style={{
                      padding: "8px 14px 16px 34px",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--ink-2)",
                      background: "var(--surface)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {e.stack && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ color: "var(--ink-3)", marginBottom: 4, letterSpacing: "0.4px" }}>STACK</div>
                        <div style={{ lineHeight: 1.5 }}>{e.stack}</div>
                      </div>
                    )}
                    {e.context && (
                      <div>
                        <div style={{ color: "var(--ink-3)", marginBottom: 4, letterSpacing: "0.4px" }}>CONTEXT</div>
                        <div style={{ lineHeight: 1.5 }}>{JSON.stringify(e.context, null, 2)}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 10,
        padding: "14px 18px",
        minWidth: 130,
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
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}
