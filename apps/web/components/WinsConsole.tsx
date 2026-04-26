"use client";

import { useCallback, useEffect, useState } from "react";

type Win = {
  id: string;
  text: string;
  kind: "shipped" | "sale" | "milestone" | "personal" | "other";
  amount_cents: number | null;
  related_to: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  last_7d: { count: number; amount_cents: number };
  last_30d: { count: number; amount_cents: number };
  all_time_amount_cents: number;
};

const KIND_COLOR: Record<Win["kind"], string> = {
  shipped: "#7affcb",
  sale: "#bfd4ee",
  milestone: "#e6d3e8",
  personal: "#f4c9d8",
  other: "var(--rule)",
};

const KIND_LABEL: Record<Win["kind"], string> = {
  shipped: "Shipped",
  sale: "Sale",
  milestone: "Milestone",
  personal: "Personal",
  other: "Other",
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatGbp(cents: number): string {
  if (!cents) return "";
  const pounds = cents / 100;
  if (pounds >= 1000) return `£${(pounds / 1000).toFixed(pounds >= 10000 ? 0 : 1)}k`;
  return `£${pounds.toFixed(pounds % 1 === 0 ? 0 : 2)}`;
}

export function WinsConsole() {
  const [rows, setRows] = useState<Win[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<"all" | Win["kind"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftText, setDraftText] = useState("");
  const [draftKind, setDraftKind] = useState<Win["kind"]>("shipped");
  const [draftAmount, setDraftAmount] = useState<string>("");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (k: "all" | Win["kind"]) => {
    setLoading(true);
    try {
      const url = k === "all" ? "/api/wins" : `/api/wins?kind=${k}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { rows: Win[]; stats: Stats };
      setRows(j.rows ?? []);
      setStats(j.stats ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const t = draftText.trim();
      if (!t) return;
      setSaving(true);
      setError(null);
      try {
        const amount = draftAmount.trim() ? Math.round(Number(draftAmount) * 100) : null;
        const r = await fetch("/api/wins", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: t,
            kind: draftKind,
            amount_cents: amount && Number.isFinite(amount) ? amount : null,
            related_to: draftNote.trim() || null,
          }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        setDraftText("");
        setDraftAmount("");
        setDraftNote("");
        await load(filter);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [draftText, draftKind, draftAmount, draftNote, filter, load],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/wins/${id}`, { method: "DELETE" });
      } finally {
        void load(filter);
      }
    },
    [filter, load],
  );

  const filterPills: Array<{ id: "all" | Win["kind"]; label: string }> = [
    { id: "all", label: "All" },
    { id: "shipped", label: "Shipped" },
    { id: "sale", label: "Sales" },
    { id: "milestone", label: "Milestones" },
    { id: "personal", label: "Personal" },
  ];

  return (
    <div
      style={{
        padding: "28px 32px 48px",
        maxWidth: 820,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
          }}
        >
          <StatCard
            label="Last 7 days"
            value={stats.last_7d.count.toString()}
            sub={stats.last_7d.amount_cents ? formatGbp(stats.last_7d.amount_cents) : ""}
          />
          <StatCard
            label="Last 30 days"
            value={stats.last_30d.count.toString()}
            sub={stats.last_30d.amount_cents ? formatGbp(stats.last_30d.amount_cents) : ""}
          />
          <StatCard
            label="All time"
            value={stats.total.toString()}
            sub={stats.all_time_amount_cents ? formatGbp(stats.all_time_amount_cents) : ""}
          />
        </div>
      )}

      <form
        onSubmit={submit}
        style={{
          padding: "20px 22px",
          borderRadius: 16,
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <input
          type="text"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          autoFocus
          maxLength={500}
          placeholder="What just happened? Closed a deal, shipped a feature, broke a PR…"
          style={{
            width: "100%",
            padding: "14px 18px",
            borderRadius: 12,
            background: "var(--bg)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 17,
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {(Object.keys(KIND_LABEL) as Array<Win["kind"]>).map((k) => {
            const active = draftKind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setDraftKind(k)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 16,
                  background: active ? KIND_COLOR[k] : "transparent",
                  color: active ? "#000" : "var(--ink-2)",
                  border: `1px solid ${active ? KIND_COLOR[k] : "var(--rule)"}`,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {KIND_LABEL[k]}
              </button>
            );
          })}
          <input
            type="text"
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            placeholder="£"
            style={{
              width: 80,
              padding: "6px 10px",
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          />
          <input
            type="text"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="related to (optional)"
            style={{
              flex: 1,
              minWidth: 100,
              padding: "6px 10px",
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          />
          <button
            type="submit"
            disabled={saving || !draftText.trim()}
            style={{
              padding: "8px 18px",
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
            {saving ? "Logging…" : "Log it"}
          </button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {filterPills.map((p) => {
          const active = filter === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              style={{
                padding: "5px 12px",
                borderRadius: 16,
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
              {p.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((w) => (
          <div
            key={w.id}
            style={{
              padding: "14px 18px",
              borderRadius: 12,
              background: "var(--panel)",
              border: "1px solid var(--rule)",
              borderLeft: `3px solid ${KIND_COLOR[w.kind]}`,
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "var(--ink)",
                  lineHeight: 1.4,
                }}
              >
                {w.text}
              </div>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--ink-3)",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  {KIND_LABEL[w.kind]} · {relTime(w.created_at)}
                </span>
                {w.amount_cents != null && w.amount_cents > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--ink-2)",
                      padding: "1px 8px",
                      borderRadius: 8,
                      background: "var(--bg)",
                      border: "1px solid var(--rule)",
                    }}
                  >
                    {formatGbp(w.amount_cents)}
                  </span>
                )}
                {w.related_to && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--ink-3)",
                      letterSpacing: 0.4,
                    }}
                  >
                    → {w.related_to}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => void remove(w.id)}
              style={{
                padding: "4px 9px",
                borderRadius: 6,
                background: "transparent",
                color: "var(--ink-3)",
                border: "1px solid var(--rule)",
                fontFamily: "var(--mono)",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        ))}

        {!loading && rows.length === 0 && (
          <div
            style={{
              padding: "36px 24px",
              textAlign: "center",
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 17,
              color: "var(--ink-3)",
              border: "1px dashed var(--rule)",
              borderRadius: 14,
            }}
          >
            Nothing here yet. The smallest win still counts.
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 14,
        background: "var(--panel)",
        border: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 30,
          color: "var(--ink)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 4,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-2)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
