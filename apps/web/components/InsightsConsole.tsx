"use client";

import { useEffect, useState } from "react";

type Bucket = {
  total: number;
  succeeded: number;
  failed: number;
  cost: number;
  success_rate: number | null;
};

type DailyPoint = { date: string; total: number; cost: number };

type KindStat = {
  kind: string;
  total: number;
  cost: number;
  success_rate: number | null;
};

type FailingKind = {
  kind: string;
  failed: number;
  total: number;
  success_rate: number | null;
};

type Split = { this: number; prior: number };

type InsightsResponse = {
  window: { this_start: string; prior_start: string; prior_end: string };
  tasks: {
    this: Bucket;
    prior: Bucket;
    daily: DailyPoint[];
    top_kinds: KindStat[];
    failing_kinds: FailingKind[];
  };
  commitments: {
    opened: Split;
    closed: Split;
  };
  receipts: {
    count: Split;
    spend_this: Record<string, number>;
    spend_prior: Record<string, number>;
  };
  subscriptions: {
    detected: Split;
  };
  memory: {
    captured: Split;
  };
};

const KIND_LABEL: Record<string, string> = {
  briefing: "Morning briefing",
  evening_wrap: "Evening wrap",
  weekly_review: "Weekly review",
  receipts_scan: "Receipts scan",
  subscription_scan: "Subscription scan",
  subscriptions_scan: "Subscription scan",
  commitments_scan: "Commitments scan",
  inbox: "Inbox triage",
  writer: "Writer",
  outreach: "Outreach",
  researcher: "Research",
  research: "Research",
  errand: "Errand",
  code_agent: "Code agent",
};

const CARD: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--rule)",
  borderRadius: 14,
  padding: 20,
};

const CARD_TITLE: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  letterSpacing: "1.6px",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  marginBottom: 12,
};

type HeatmapResponse = {
  days: number;
  currency: string;
  series: Array<{ date: string; total: number; count: number }>;
  max: number;
  total: number;
  top_days: Array<{ date: string; total: number; count: number }>;
  weekday_avg: number[];
  by_currency: Record<string, number>;
};

export function InsightsConsole() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [weekly, heat] = await Promise.all([
          fetch("/api/insights/weekly", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/insights/heatmap?days=84", { cache: "no-store" }).then((r) =>
            r.json(),
          ),
        ]);
        if (alive) {
          setData(weekly as InsightsResponse);
          setHeatmap(heat as HeatmapResponse);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "28px 32px 40px", color: "var(--ink-3)", fontSize: 13 }}>
        Loading…
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: "28px 32px 40px", color: "var(--ink-3)", fontSize: 13 }}>
        No data.
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 1100 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <StatCard
          label="Tasks run"
          value={data.tasks.this.total}
          prior={data.tasks.prior.total}
        />
        <StatCard
          label="Success rate"
          value={data.tasks.this.success_rate}
          prior={data.tasks.prior.success_rate}
          format="percent"
        />
        <StatCard
          label="Task cost"
          value={data.tasks.this.cost}
          prior={data.tasks.prior.cost}
          format="usd"
          inverse
        />
        <StatCard
          label="Failed tasks"
          value={data.tasks.this.failed}
          prior={data.tasks.prior.failed}
          inverse
        />
      </div>

      <div style={{ ...CARD, marginBottom: 18 }}>
        <div style={CARD_TITLE}>Daily volume · last 7 days</div>
        <DailyChart points={data.tasks.daily} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div style={CARD}>
          <div style={CARD_TITLE}>Top agents this week</div>
          {data.tasks.top_kinds.length === 0 ? (
            <Empty />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.tasks.top_kinds.map((k, i, arr) => (
                <KindBar
                  key={k.kind}
                  kind={k.kind}
                  count={k.total}
                  max={arr[0]?.total ?? 1}
                  successRate={k.success_rate}
                />
              ))}
            </div>
          )}
        </div>
        <div style={CARD}>
          <div style={CARD_TITLE}>Failing kinds</div>
          {data.tasks.failing_kinds.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
              No failures in the last 7 days. Nice.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.tasks.failing_kinds.map((k) => (
                <div
                  key={k.kind}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--rule)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--sans)",
                      fontSize: 13,
                      color: "var(--ink)",
                    }}
                  >
                    {KIND_LABEL[k.kind] ?? k.kind}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      color: "var(--magenta)",
                    }}
                  >
                    {k.failed} failed · {fmtPercent(k.success_rate)} ok
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <SplitCard
          title="Commitments opened"
          split={data.commitments.opened}
          inverse
        />
        <SplitCard title="Commitments closed" split={data.commitments.closed} />
        <SplitCard title="Memories captured" split={data.memory.captured} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}
      >
        <div style={CARD}>
          <div style={CARD_TITLE}>Receipt capture</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              style={{
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 32,
                lineHeight: 1,
                color: "var(--ink)",
              }}
            >
              {data.receipts.count.this}
            </span>
            <Delta
              current={data.receipts.count.this}
              prior={data.receipts.count.prior}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            {Object.keys(data.receipts.spend_this).length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                No spend logged this week.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(data.receipts.spend_this).map(([cur, amt]) => (
                  <div
                    key={cur}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: "var(--ink-2)",
                    }}
                  >
                    <span>{cur}</span>
                    <span>
                      {fmtMoney(amt, cur)}{" "}
                      <SpendDelta
                        current={amt}
                        prior={data.receipts.spend_prior[cur] ?? 0}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <SplitCard title="Subscriptions detected" split={data.subscriptions.detected} />
      </div>

      {heatmap && heatmap.series.length > 0 && (
        <div style={{ ...CARD, marginTop: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div style={CARD_TITLE}>
              Spending heatmap · last {heatmap.days} days · {heatmap.currency}
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              total {fmtMoney(heatmap.total, heatmap.currency)}
            </div>
          </div>
          <SpendHeatmap data={heatmap} />
          {heatmap.top_days.length > 0 && (
            <div
              style={{
                marginTop: 16,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              {heatmap.top_days.map((d, i) => (
                <div
                  key={d.date}
                  style={{
                    padding: "8px 12px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--rule)",
                    borderRadius: 8,
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--ink-2)",
                  }}
                >
                  <span style={{ color: "var(--ink-3)", marginRight: 8 }}>
                    #{i + 1}
                  </span>
                  {new Date(d.date).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                  })}
                  <span style={{ color: "var(--indigo)", marginLeft: 8 }}>
                    {fmtMoney(d.total, heatmap.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpendHeatmap({ data }: { data: HeatmapResponse }) {
  const series = data.series;
  const first = series[0];
  if (!first) return null;
  const firstDow = new Date(first.date).getDay();
  const padded: Array<{ date: string; total: number; count: number } | null> = [];
  for (let i = 0; i < firstDow; i++) padded.push(null);
  padded.push(...series);

  const weeks: Array<Array<{ date: string; total: number; count: number } | null>> =
    [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div
        style={{
          display: "grid",
          gridTemplateRows: "repeat(7, 14px)",
          gap: 3,
          fontFamily: "var(--mono)",
          fontSize: 9,
          color: "var(--ink-3)",
          paddingTop: 2,
        }}
      >
        {weekdayLabels.map((l, i) => (
          <div
            key={i}
            style={{
              height: 14,
              width: 10,
              textAlign: "center",
              visibility: i % 2 === 1 ? "visible" : "hidden",
            }}
          >
            {l}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridAutoFlow: "column",
          gridTemplateRows: "repeat(7, 14px)",
          gap: 3,
          overflowX: "auto",
        }}
      >
        {weeks.flatMap((week, wi) =>
          Array.from({ length: 7 }).map((_, di) => {
            const cell = week[di];
            if (!cell) {
              return (
                <div
                  key={`${wi}-${di}`}
                  style={{ width: 14, height: 14 }}
                  aria-hidden
                />
              );
            }
            const intensity =
              data.max > 0 && cell.total > 0 ? cell.total / data.max : 0;
            const bg =
              cell.total === 0
                ? "rgba(255,255,255,0.04)"
                : `rgba(124, 134, 255, ${0.18 + intensity * 0.75})`;
            return (
              <div
                key={`${wi}-${di}`}
                title={`${cell.date} · ${fmtMoney(cell.total, data.currency)} · ${cell.count} receipt${cell.count === 1 ? "" : "s"}`}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: bg,
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  prior,
  format,
  inverse,
}: {
  label: string;
  value: number | null;
  prior: number | null;
  format?: "percent" | "usd";
  inverse?: boolean;
}) {
  const display =
    value == null
      ? "—"
      : format === "percent"
        ? fmtPercent(value)
        : format === "usd"
          ? `$${value.toFixed(2)}`
          : String(value);

  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>{label}</div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 30,
          lineHeight: 1,
          color: "var(--ink)",
          marginBottom: 8,
        }}
      >
        {display}
      </div>
      <Delta current={value} prior={prior} inverse={inverse} format={format} />
    </div>
  );
}

function SplitCard({
  title,
  split,
  inverse,
}: {
  title: string;
  split: Split;
  inverse?: boolean;
}) {
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 30,
            lineHeight: 1,
            color: "var(--ink)",
          }}
        >
          {split.this}
        </span>
        <Delta current={split.this} prior={split.prior} inverse={inverse} />
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--ink-3)",
          letterSpacing: "0.4px",
        }}
      >
        prior 7d · {split.prior}
      </div>
    </div>
  );
}

function Delta({
  current,
  prior,
  inverse,
  format,
}: {
  current: number | null;
  prior: number | null;
  inverse?: boolean;
  format?: "percent" | "usd";
}) {
  if (current == null || prior == null) {
    return (
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
        —
      </span>
    );
  }
  const diff = current - prior;
  if (prior === 0 && current === 0) {
    return (
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
        flat
      </span>
    );
  }
  const up = diff > 0;
  const good = inverse ? !up : up;
  const color =
    diff === 0 ? "var(--ink-3)" : good ? "var(--indigo)" : "var(--magenta)";
  const arrow = diff === 0 ? "·" : up ? "▲" : "▼";
  const pct =
    prior === 0 ? null : Math.round((Math.abs(diff) / Math.abs(prior)) * 100);
  const magnitude =
    format === "percent"
      ? `${Math.round(Math.abs(diff) * 100)}pt`
      : format === "usd"
        ? `$${Math.abs(diff).toFixed(2)}`
        : String(Math.abs(diff));

  return (
    <span
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        color,
        letterSpacing: "0.3px",
      }}
    >
      {arrow} {magnitude}
      {pct != null && ` · ${pct}%`}
    </span>
  );
}

function SpendDelta({ current, prior }: { current: number; prior: number }) {
  if (prior === 0 && current === 0) return null;
  const diff = current - prior;
  if (diff === 0) return null;
  const color = diff > 0 ? "var(--magenta)" : "var(--indigo)";
  return (
    <span style={{ color, marginLeft: 6 }}>
      {diff > 0 ? "▲" : "▼"}
      {Math.abs(diff).toFixed(2)}
    </span>
  );
}

function DailyChart({ points }: { points: DailyPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.total));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${points.length}, 1fr)`,
        gap: 8,
        alignItems: "end",
        height: 140,
      }}
    >
      {points.map((p) => {
        const h = Math.max(2, Math.round((p.total / max) * 110));
        const d = new Date(p.date);
        const dayLabel = d.toLocaleDateString("en-GB", { weekday: "short" });
        return (
          <div
            key={p.date}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "end",
              height: "100%",
              gap: 6,
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--ink-3)",
              }}
            >
              {p.total}
            </div>
            <div
              title={`${p.date} · ${p.total} tasks · $${p.cost.toFixed(2)}`}
              style={{
                width: "60%",
                height: h,
                background: "var(--indigo)",
                opacity: 0.85,
                borderRadius: 4,
                transition: "height 400ms ease",
              }}
            />
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.6px",
                color: "var(--ink-3)",
                textTransform: "uppercase",
              }}
            >
              {dayLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KindBar({
  kind,
  count,
  max,
  successRate,
}: {
  kind: string;
  count: number;
  max: number;
  successRate: number | null;
}) {
  const w = max > 0 ? Math.round((count / max) * 100) : 0;
  const srColor =
    successRate == null
      ? "var(--ink-3)"
      : successRate >= 0.9
        ? "var(--indigo)"
        : successRate < 0.7
          ? "var(--magenta)"
          : "var(--ink-2)";
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            color: "var(--ink-2)",
          }}
        >
          {KIND_LABEL[kind] ?? kind}
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          {count}
          <span style={{ color: srColor, marginLeft: 8 }}>
            {successRate == null ? "—" : fmtPercent(successRate)}
          </span>
        </span>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: "rgba(255,255,255,0.05)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${w}%`,
            height: "100%",
            background: "var(--violet)",
          }}
        />
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
      Nothing to show yet.
    </div>
  );
}

function fmtPercent(n: number | null): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtMoney(amt: number, cur: string): string {
  const sym = cur === "USD" ? "$" : cur === "GBP" ? "£" : cur === "EUR" ? "€" : "";
  return `${sym}${amt.toFixed(2)}`;
}
