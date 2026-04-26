"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// /money dashboard — consolidates waste signals across receipts, subscriptions
// and budgets. Purely an aggregator over existing endpoints; no new DB state.

interface Receipt {
  id: string;
  merchant: string;
  amount: number | null;
  currency: string;
  purchased_at: string | null;
  archived: boolean;
}

interface Subscription {
  id: string;
  service_name: string;
  amount: number | null;
  currency: string;
  cadence: "weekly" | "monthly" | "quarterly" | "annual" | "unknown";
  status: "active" | "trial" | "cancelled" | "paused" | "unknown";
  last_charged_at: string | null;
  last_seen_at: string;
}

interface Budget {
  id: string;
  category: string;
  amount: number;
  currency: string;
  active: boolean;
  status: {
    spent: number;
    percent: number;
    state: "ok" | "warn" | "breach";
  } | null;
}

function monthlyEquiv(amount: number | null, cadence: string): number | null {
  if (amount == null) return null;
  switch (cadence) {
    case "weekly":
      return amount * 4.33;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "annual":
      return amount / 12;
    default:
      return null;
  }
}

function staleThresholdDays(cadence: Subscription["cadence"]): number | null {
  switch (cadence) {
    case "weekly":
      return 21;
    case "monthly":
      return 60;
    case "quarterly":
      return 135;
    case "annual":
      return 400;
    default:
      return null;
  }
}

function isStale(s: Subscription): boolean {
  if (s.status !== "active" && s.status !== "trial") return false;
  const t = staleThresholdDays(s.cadence);
  if (t == null) return false;
  const ref = s.last_charged_at ?? s.last_seen_at;
  if (!ref) return false;
  const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
  return days >= t;
}

function money(n: number, ccy: string): string {
  const sym = ccy === "GBP" ? "£" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : "";
  return sym ? `${sym}${n.toFixed(2)}` : `${n.toFixed(2)} ${ccy}`;
}

function sumByCurrency(entries: Array<{ amount: number; currency: string }>) {
  const acc: Record<string, number> = {};
  for (const e of entries) {
    acc[e.currency] = (acc[e.currency] ?? 0) + e.amount;
  }
  return acc;
}

function renderByCurrency(byCcy: Record<string, number>): string {
  const keys = Object.keys(byCcy);
  if (keys.length === 0) return "—";
  return keys
    .sort((a, b) => (byCcy[b] ?? 0) - (byCcy[a] ?? 0))
    .map((k) => money(byCcy[k] ?? 0, k))
    .join(" + ");
}

export function MoneyConsole() {
  const [loading, setLoading] = useState(true);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rr, sr, br] = await Promise.all([
          fetch("/api/receipts?limit=300&archived=false", { cache: "no-store" }),
          fetch("/api/subscriptions", { cache: "no-store" }),
          fetch("/api/budgets", { cache: "no-store" }),
        ]);
        const rd = (await rr.json().catch(() => ({}))) as { receipts?: Receipt[] };
        const sd = (await sr.json().catch(() => ({}))) as {
          subscriptions?: Subscription[];
        };
        const bd = (await br.json().catch(() => ({}))) as { budgets?: Budget[] };
        if (!alive) return;
        setReceipts(rd.receipts ?? []);
        setSubs(sd.subscriptions ?? []);
        setBudgets(bd.budgets ?? []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Last-30-day spend from receipts (non-archived).
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const last30 = receipts.filter((r) => {
    if (r.archived || r.amount == null || !r.purchased_at) return false;
    const t = new Date(r.purchased_at).getTime();
    return Number.isFinite(t) && t >= thirtyDaysAgo;
  });
  const spend30By = sumByCurrency(
    last30.map((r) => ({ amount: r.amount ?? 0, currency: r.currency })),
  );

  // Active subs monthly equivalent.
  const activeSubs = subs.filter(
    (s) => s.status === "active" || s.status === "trial",
  );
  const activeSubsMonthlyBy = sumByCurrency(
    activeSubs.flatMap((s) => {
      const m = monthlyEquiv(s.amount, s.cadence);
      return m != null ? [{ amount: m, currency: s.currency }] : [];
    }),
  );

  // Stale subs — potential savings.
  const staleSubs = activeSubs.filter(isStale);
  const staleMonthlyBy = sumByCurrency(
    staleSubs.flatMap((s) => {
      const m = monthlyEquiv(s.amount, s.cadence);
      return m != null ? [{ amount: m, currency: s.currency }] : [];
    }),
  );

  // Potential duplicate receipts.
  const dupePairs: Array<[Receipt, Receipt]> = [];
  {
    const buckets = new Map<string, Receipt[]>();
    for (const r of receipts) {
      if (r.archived || r.amount == null || !r.purchased_at) continue;
      const k = `${r.merchant.toLowerCase().replace(/\s+/g, "")}|${r.amount.toFixed(2)}|${r.currency}`;
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    for (const [, arr] of buckets) {
      if (arr.length < 2) continue;
      arr.sort((a, b) =>
        (a.purchased_at ?? "").localeCompare(b.purchased_at ?? ""),
      );
      for (let i = 0; i < arr.length; i += 1) {
        for (let j = i + 1; j < arr.length; j += 1) {
          const a = arr[i];
          const b = arr[j];
          if (!a || !b || !a.purchased_at || !b.purchased_at) continue;
          const deltaDays = Math.abs(
            (new Date(a.purchased_at).getTime() -
              new Date(b.purchased_at).getTime()) /
              86400000,
          );
          if (deltaDays <= 7) dupePairs.push([a, b]);
          else break;
        }
      }
    }
  }
  const dupeAmountBy = sumByCurrency(
    dupePairs.map(([a]) => ({ amount: a.amount ?? 0, currency: a.currency })),
  );

  // Budget breaches (over 100%).
  const breaches = budgets.filter(
    (b) => b.active && b.status && b.status.state === "breach",
  );
  const breachOverBy = sumByCurrency(
    breaches.flatMap((b) =>
      b.status ? [{ amount: b.status.spent - b.amount, currency: b.currency }] : [],
    ),
  );

  // Total potential savings = stale subs monthly + dupe amounts + breach overage.
  const totalWasteBy: Record<string, number> = {};
  for (const [k, v] of Object.entries(staleMonthlyBy))
    totalWasteBy[k] = (totalWasteBy[k] ?? 0) + v;
  for (const [k, v] of Object.entries(dupeAmountBy))
    totalWasteBy[k] = (totalWasteBy[k] ?? 0) + v;
  for (const [k, v] of Object.entries(breachOverBy))
    totalWasteBy[k] = (totalWasteBy[k] ?? 0) + v;

  if (loading) {
    return (
      <div style={{ padding: "28px 32px 40px", color: "var(--ink-3)", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 960 }}>
      {/* Hero — spend vs waste */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: 22,
          marginBottom: 22,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
        }}
      >
        <HeroStat
          label="30-day spend"
          value={renderByCurrency(spend30By)}
          hint={`${last30.length} purchases`}
        />
        <HeroStat
          label="Potential savings"
          value={renderByCurrency(totalWasteBy)}
          hint={
            Object.keys(totalWasteBy).length === 0
              ? "Nothing obvious to fix"
              : "Across stale subs, duplicates and budget overage"
          }
          accent="#FBBF24"
        />
      </div>

      {/* Action tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        <WasteTile
          title="Stale subscriptions"
          count={staleSubs.length}
          amount={renderByCurrency(staleMonthlyBy)}
          amountSuffix="/mo"
          empty="No stale active subs detected."
          href="/subscriptions"
          body={
            staleSubs.length > 0
              ? staleSubs
                  .slice(0, 5)
                  .map((s) => s.service_name)
                  .join(" · ")
              : null
          }
        />
        <WasteTile
          title="Potential duplicate charges"
          count={dupePairs.length}
          amount={renderByCurrency(dupeAmountBy)}
          empty="No matching pairs in the last 300 receipts."
          href="/receipts"
          body={
            dupePairs.length > 0
              ? dupePairs
                  .slice(0, 5)
                  .map(([a]) => a.merchant)
                  .join(" · ")
              : null
          }
        />
        <WasteTile
          title="Budgets over 100%"
          count={breaches.length}
          amount={renderByCurrency(breachOverBy)}
          empty={
            budgets.length === 0
              ? "No budgets set yet."
              : "Everything's within cap."
          }
          href="/budgets"
          body={
            breaches.length > 0
              ? breaches.map((b) => b.category).join(" · ")
              : null
          }
        />
        <WasteTile
          title="Active subscriptions"
          count={activeSubs.length}
          amount={renderByCurrency(activeSubsMonthlyBy)}
          amountSuffix="/mo"
          empty="No subscriptions tracked yet."
          href="/subscriptions"
          neutral
          body={
            activeSubs.length > 0
              ? activeSubs
                  .slice(0, 5)
                  .map((s) => s.service_name)
                  .join(" · ")
              : null
          }
        />
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.6px",
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
          fontSize: 34,
          fontStyle: "italic",
          color: accent ?? "var(--ink)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            marginTop: 6,
            letterSpacing: "0.4px",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function WasteTile({
  title,
  count,
  amount,
  amountSuffix,
  empty,
  href,
  body,
  neutral,
}: {
  title: string;
  count: number;
  amount: string;
  amountSuffix?: string;
  empty: string;
  href: string;
  body: string | null;
  neutral?: boolean;
}) {
  const isEmpty = count === 0;
  const accent = neutral ? "var(--indigo)" : "#FBBF24";
  return (
    <Link
      href={href}
      style={{
        background: "var(--surface)",
        border: `1px solid ${isEmpty || neutral ? "var(--rule)" : accent}`,
        borderRadius: 12,
        padding: 16,
        textDecoration: "none",
        color: "inherit",
        display: "block",
        transition: "border-color 180ms ease",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 24,
          color: isEmpty ? "var(--ink-3)" : accent,
          lineHeight: 1.1,
        }}
      >
        {count} · {amount}
        {amountSuffix ? (
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.5px",
              marginLeft: 4,
              color: "var(--ink-3)",
            }}
          >
            {amountSuffix}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--ink-3)",
          marginTop: 8,
          letterSpacing: "0.3px",
          lineHeight: 1.4,
          minHeight: 16,
        }}
      >
        {isEmpty ? empty : (body ?? "")}
      </div>
    </Link>
  );
}
