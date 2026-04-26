"use client";

import { useCallback, useEffect, useState } from "react";

interface DayBucket {
  date: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

interface ModelBucket {
  tier: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

interface ConvBucket {
  conversation_id: string;
  title: string;
  calls: number;
  cost_usd: number;
}

interface PricingRow {
  tier: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
}

interface Summary {
  days: number;
  totals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cost_usd: number;
  };
  perDay: DayBucket[];
  perModel: ModelBucket[];
  topConversations: ConvBucket[];
  pricing: PricingRow[];
}

const TIER_COLOR: Record<string, string> = {
  haiku: "#7DD3FC",
  sonnet: "#A78BFA",
  opus: "#F472B6",
  unknown: "#6B7280",
};

function money(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function LlmCostConsole() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/llm-cost/summary?days=${days}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as Summary;
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDayCost = summary
    ? Math.max(0.0001, ...summary.perDay.map((d) => d.cost_usd))
    : 1;

  return (
    <div style={{ padding: "24px 32px 48px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[7, 14, 30, 60, 90].map((d) => (
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
            <Stat label="SPEND" value={money(summary.totals.cost_usd)} emphasis />
            <Stat label="CALLS" value={String(summary.totals.calls)} />
            <Stat label="INPUT" value={tokens(summary.totals.input_tokens)} />
            <Stat label="OUTPUT" value={tokens(summary.totals.output_tokens)} />
            <Stat label="CACHE READ" value={tokens(summary.totals.cache_read_tokens)} />
          </div>

          <Section title="SPEND PER DAY">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140 }}>
              {summary.perDay.map((d) => (
                <div
                  key={d.date}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: `${(d.cost_usd / maxDayCost) * 100}%`,
                      minHeight: 2,
                      background: "var(--indigo)",
                      borderRadius: 2,
                      opacity: d.cost_usd ? 1 : 0.15,
                    }}
                    title={`${d.date}: ${money(d.cost_usd)} · ${d.calls} calls`}
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
              marginTop: 24,
            }}
          >
            <Section title="BY MODEL">
              {summary.perModel.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {summary.perModel.map((m) => (
                    <ModelRow key={m.tier} m={m} total={summary.totals.cost_usd} />
                  ))}
                </div>
              )}
            </Section>

            <Section title="MOST EXPENSIVE CONVERSATIONS">
              {summary.topConversations.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {summary.topConversations.map((c) => (
                    <a
                      key={c.conversation_id}
                      href={`/history?c=${c.conversation_id}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        border: "1px solid var(--rule)",
                        borderRadius: 8,
                        color: "var(--ink-2)",
                        textDecoration: "none",
                        fontFamily: "var(--sans)",
                        fontSize: 12.5,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.title}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--ink-3)",
                        }}
                      >
                        {c.calls}×
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          color: "var(--ink)",
                          minWidth: 60,
                          textAlign: "right",
                        }}
                      >
                        {money(c.cost_usd)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </Section>
          </div>

          <div style={{ marginTop: 28 }}>
            <AgentPerformanceSection days={days} />
          </div>

          <div style={{ marginTop: 28 }}>
            <Section title="RATE CARD — USD / 1M TOKENS">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr 1fr 1fr",
                  gap: 6,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  letterSpacing: "0.4px",
                }}
              >
                <div>TIER</div>
                <div>INPUT</div>
                <div>OUTPUT</div>
                <div>CACHE READ</div>
                {summary.pricing.map((p) => (
                  <RateRow key={p.tier} p={p} />
                ))}
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${emphasis ? "var(--indigo)" : "var(--rule)"}`,
        borderRadius: 10,
        padding: "14px 18px",
        minWidth: 140,
        background: emphasis ? "var(--indigo-soft)" : "var(--surface)",
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
          fontSize: emphasis ? 32 : 26,
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

function ModelRow({ m, total }: { m: ModelBucket; total: number }) {
  const color = TIER_COLOR[m.tier] ?? TIER_COLOR.unknown;
  const pct = total > 0 ? (m.cost_usd / total) * 100 : 0;
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 8,
        padding: "10px 14px",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color,
            }}
          />
          <span
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              color: "var(--ink)",
              textTransform: "capitalize",
            }}
          >
            {m.tier}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
            }}
          >
            {m.calls} CALLS · IN {tokens(m.input_tokens)} · OUT {tokens(m.output_tokens)}
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--ink)",
          }}
        >
          {money(m.cost_usd)}
        </div>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--rule)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
          }}
        />
      </div>
    </div>
  );
}

function RateRow({ p }: { p: PricingRow }) {
  return (
    <>
      <div
        style={{
          color: "var(--ink)",
          textTransform: "capitalize",
        }}
      >
        {p.tier}
      </div>
      <div style={{ color: "var(--ink-2)" }}>${p.input_per_mtok.toFixed(2)}</div>
      <div style={{ color: "var(--ink-2)" }}>${p.output_per_mtok.toFixed(2)}</div>
      <div style={{ color: "var(--ink-2)" }}>${p.cache_read_per_mtok.toFixed(2)}</div>
    </>
  );
}

function Empty() {
  return (
    <div
      style={{
        padding: 28,
        textAlign: "center",
        color: "var(--ink-3)",
        fontSize: 12,
        border: "1px dashed var(--rule)",
        borderRadius: 10,
      }}
    >
      No usage in this window yet.
    </div>
  );
}

interface KindStats {
  kind: string;
  total: number;
  succeeded: number;
  failed: number;
  needs_approval: number;
  running: number;
  queued: number;
  cancelled: number;
  success_rate: number | null;
  total_cost_usd: number;
  avg_cost_usd: number;
  avg_latency_seconds: number | null;
  latency_samples: number;
}

const KIND_LABEL: Record<string, string> = {
  briefing: "Morning briefing",
  evening_wrap: "Evening wrap",
  weekly_review: "Weekly review",
  inbox: "Inbox triage",
  writer: "Writer",
  outreach: "Cold outreach",
  research: "Researcher",
  researcher: "Researcher",
  errand: "Errand",
  code_agent: "Code agent",
  receipts_scan: "Receipts sweep",
  subscription_scan: "Subscriptions sweep",
  subscriptions_scan: "Subscriptions sweep",
  commitments_scan: "Commitments sweep",
  crypto_send: "Crypto send",
  concierge: "Concierge",
  meeting_ghost: "Meeting ghost",
  reminder: "Reminder",
  ops: "Reminder",
};

function AgentPerformanceSection({ days }: { days: number }) {
  const [kinds, setKinds] = useState<KindStats[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tasks/performance?days=${days}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ kinds: KindStats[] }>)
      .then((d) => {
        if (!cancelled) setKinds(d.kinds ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <Section title="AGENT PERFORMANCE — BY KIND">
      {loading || !kinds ? (
        <div style={{ color: "var(--ink-3)", fontSize: 12 }}>Loading…</div>
      ) : kinds.length === 0 ? (
        <Empty />
      ) : (
        <div
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 0.7fr 0.9fr 0.8fr 0.9fr",
              gap: 6,
              padding: "10px 14px",
              background: "var(--surface)",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.6px",
              borderBottom: "1px solid var(--rule)",
            }}
          >
            <div>KIND</div>
            <div style={{ textAlign: "right" }}>RUNS</div>
            <div style={{ textAlign: "right" }}>SUCCESS</div>
            <div style={{ textAlign: "right" }}>AVG COST</div>
            <div style={{ textAlign: "right" }}>AVG LATENCY</div>
          </div>
          {kinds.map((k) => (
            <KindRow key={k.kind} k={k} />
          ))}
        </div>
      )}
    </Section>
  );
}

function KindRow({ k }: { k: KindStats }) {
  const label = KIND_LABEL[k.kind] ?? k.kind;
  const successColor =
    k.success_rate === null
      ? "var(--ink-3)"
      : k.success_rate >= 0.9
      ? "var(--indigo)"
      : k.success_rate >= 0.7
      ? "var(--ink-2)"
      : "var(--magenta, #ff6b6b)";
  const successStr =
    k.success_rate === null
      ? "—"
      : `${Math.round(k.success_rate * 100)}% (${k.succeeded}/${k.succeeded + k.failed})`;
  const latencyStr =
    k.avg_latency_seconds === null
      ? "—"
      : k.avg_latency_seconds >= 60
      ? `${Math.round(k.avg_latency_seconds / 6) / 10}m`
      : `${k.avg_latency_seconds.toFixed(1)}s`;
  const costStr = k.avg_cost_usd < 0.01
    ? `${(k.avg_cost_usd * 100).toFixed(2)}¢`
    : k.avg_cost_usd < 1
    ? `${(k.avg_cost_usd * 100).toFixed(1)}¢`
    : `$${k.avg_cost_usd.toFixed(2)}`;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 0.7fr 0.9fr 0.8fr 0.9fr",
        gap: 6,
        padding: "10px 14px",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        borderBottom: "1px solid var(--rule-soft, var(--rule))",
      }}
    >
      <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink)" }}>
        {label}
      </div>
      <div style={{ textAlign: "right", color: "var(--ink-2)" }}>{k.total}</div>
      <div style={{ textAlign: "right", color: successColor }}>{successStr}</div>
      <div style={{ textAlign: "right", color: "var(--ink-2)" }}>{costStr}</div>
      <div style={{ textAlign: "right", color: "var(--ink-2)" }}>{latencyStr}</div>
    </div>
  );
}
