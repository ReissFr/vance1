"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Status {
  budget_id: string;
  category: string;
  amount: number;
  currency: string;
  spent: number;
  percent: number;
  state: "ok" | "warn" | "breach";
  period_start: string;
  include_subs: boolean;
}

interface Budget {
  id: string;
  category: string;
  amount: number;
  currency: string;
  include_subs: boolean;
  active: boolean;
  notes: string | null;
  created_at: string;
  status: Status | null;
}

const STATE_COLOR: Record<Status["state"], string> = {
  ok: "#10B981",
  warn: "#FBBF24",
  breach: "#F87171",
};

function money(n: number, ccy: string): string {
  const sym = ccy === "GBP" ? "£" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : "";
  return sym ? `${sym}${n.toFixed(2)}` : `${n.toFixed(2)} ${ccy}`;
}

function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(rows: Budget[]) {
  const header = [
    "category",
    "amount",
    "currency",
    "spent",
    "percent",
    "state",
    "include_subs",
    "active",
    "period_start",
    "notes",
    "created_at",
  ];
  const lines = [header.join(",")];
  for (const b of rows) {
    const s = b.status;
    lines.push(
      [
        b.category,
        b.amount,
        b.currency,
        s?.spent ?? "",
        s ? s.percent.toFixed(1) : "",
        s?.state ?? "",
        b.include_subs ? "1" : "0",
        b.active ? "1" : "0",
        s?.period_start ?? "",
        b.notes ?? "",
        b.created_at,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `budgets-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BudgetsConsole() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [includeSubs, setIncludeSubs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/budgets", { cache: "no-store" });
      const data = (await res.json()) as { budgets: Budget[] };
      setBudgets(data.budgets ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const suggest = useCallback(async () => {
    const cat = category.trim();
    if (!cat) return;
    setSuggesting(true);
    setSuggestNote(null);
    try {
      const params = new URLSearchParams({ category: cat, currency });
      const res = await fetch(`/api/budgets/suggest?${params.toString()}`);
      if (!res.ok) throw new Error("suggest failed");
      const data = (await res.json()) as {
        suggested: number;
        samples: number;
        note: string;
      };
      if (data.samples === 0) {
        setSuggestNote("No receipts found for this category in the last 90 days.");
      } else {
        setAmount(String(data.suggested));
        setSuggestNote(`${data.note} · avg + 10% headroom`);
      }
    } catch {
      setSuggestNote("Suggestion failed.");
    } finally {
      setSuggesting(false);
    }
  }, [category, currency]);

  const addBudget = useCallback(async () => {
    if (!category.trim() || !amount) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSaving(true);
    try {
      await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: category.trim(),
          amount: amt,
          currency,
          include_subs: includeSubs,
        }),
      });
      setCategory("");
      setAmount("");
      await load();
    } finally {
      setSaving(false);
    }
  }, [category, amount, currency, includeSubs, load]);

  const toggleActive = useCallback(
    async (b: Budget) => {
      await fetch(`/api/budgets/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !b.active }),
      });
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Remove this budget?")) return;
      await fetch(`/api/budgets/${id}`, { method: "DELETE" });
      await load();
    },
    [load],
  );

  return (
    <div style={{ padding: "24px 32px 48px" }}>
      <div
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 12,
          padding: 18,
          marginBottom: 24,
          background: "var(--surface)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <Field label="CATEGORY" style={{ flex: "1 1 180px" }}>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. groceries"
            style={inputStyle}
          />
        </Field>
        <Field label="MONTHLY" style={{ width: 140 }}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="500.00"
            inputMode="decimal"
            style={inputStyle}
          />
        </Field>
        <button
          onClick={suggest}
          disabled={!category.trim() || suggesting}
          title="Suggest a budget from the last 90 days of receipts"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            padding: "10px 12px",
            background: "transparent",
            color: "var(--ink-2)",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            cursor: !category.trim() || suggesting ? "not-allowed" : "pointer",
            letterSpacing: "0.6px",
            opacity: !category.trim() ? 0.4 : 1,
          }}
        >
          {suggesting ? "…" : "SUGGEST"}
        </button>
        <Field label="CURRENCY" style={{ width: 100 }}>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle}>
            <option>GBP</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
        </Field>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--sans)",
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          <input type="checkbox" checked={includeSubs} onChange={(e) => setIncludeSubs(e.target.checked)} />
          Include subscriptions
        </label>
        <button
          onClick={addBudget}
          disabled={saving || !category.trim() || !amount}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "10px 16px",
            background: "var(--indigo-soft)",
            color: "var(--ink)",
            border: "1px solid var(--indigo)",
            borderRadius: 8,
            cursor: saving ? "wait" : "pointer",
            letterSpacing: "0.6px",
            opacity: !category.trim() || !amount ? 0.4 : 1,
          }}
        >
          {saving ? "SAVING…" : "ADD BUDGET"}
        </button>
      </div>
      {suggestNote && (
        <div
          style={{
            marginTop: -14,
            marginBottom: 18,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
          }}
        >
          {suggestNote}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : budgets.length === 0 ? (
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
          No budgets yet. Set one above — spending is pulled from receipts
          (and optionally subscriptions) by category.
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-3)",
                letterSpacing: "1.4px",
                textTransform: "uppercase",
              }}
            >
              {budgets.length} BUDGET{budgets.length === 1 ? "" : "S"}
            </div>
            <button
              onClick={() => downloadCsv(budgets)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                padding: "6px 12px",
                background: "transparent",
                color: "var(--ink-3)",
                border: "1px solid var(--rule)",
                borderRadius: 6,
                cursor: "pointer",
                letterSpacing: "0.6px",
              }}
            >
              EXPORT CSV
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {budgets.map((b) => (
              <BudgetRow key={b.id} b={b} onToggle={() => toggleActive(b)} onRemove={() => remove(b.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function projectEndOfMonth(
  spent: number,
  periodStart: string,
): { projected: number; daysElapsed: number; daysInMonth: number } | null {
  const start = new Date(periodStart);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  const daysElapsed = Math.max(
    1,
    Math.floor((now.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1,
  );
  const daysInMonth = new Date(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    0,
  ).getUTCDate();
  if (daysElapsed < 3 || daysElapsed >= daysInMonth) return null;
  const dailyBurn = spent / daysElapsed;
  return { projected: dailyBurn * daysInMonth, daysElapsed, daysInMonth };
}

function BudgetRow({
  b,
  onToggle,
  onRemove,
}: {
  b: Budget;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const s = b.status;
  const percent = s?.percent ?? 0;
  const state = s?.state ?? "ok";
  const color = STATE_COLOR[state];
  const dimmed = !b.active;

  const projection =
    s && b.active && percent < 95
      ? projectEndOfMonth(s.spent, s.period_start)
      : null;
  const projectedOver =
    projection && projection.projected > b.amount * 1.05
      ? projection.projected
      : null;

  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 12,
        padding: "14px 18px",
        background: "var(--surface)",
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link
            href={`/receipts?category=${encodeURIComponent(b.category)}`}
            title={`See receipts tagged '${b.category}'`}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 14.5,
              color: "var(--ink)",
              fontWeight: 500,
              textDecoration: "none",
              borderBottom: "1px dashed var(--rule)",
              paddingBottom: 1,
            }}
          >
            {b.category}
          </Link>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
              marginTop: 4,
            }}
          >
            {money(s?.spent ?? 0, b.currency)} OF {money(b.amount, b.currency)}
            {b.include_subs && " · INCL SUBS"}
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 22,
            color,
            lineHeight: 1,
            minWidth: 70,
            textAlign: "right",
          }}
        >
          {percent.toFixed(0)}%
        </div>
        <button
          onClick={onToggle}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            background: "transparent",
            color: "var(--ink-3)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            padding: "5px 10px",
            cursor: "pointer",
            letterSpacing: "0.4px",
          }}
        >
          {b.active ? "OFF" : "ON"}
        </button>
        <button
          onClick={onRemove}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 14,
            background: "transparent",
            color: "var(--ink-3)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            padding: "3px 9px",
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--rule)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, percent)}%`,
            height: "100%",
            background: color,
            transition: "width 200ms var(--ease)",
          }}
        />
      </div>
      {projectedOver && (
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: STATE_COLOR.warn,
            letterSpacing: "0.3px",
          }}
          title={`Burn rate ${formatMoney(
            projection!.projected / projection!.daysInMonth,
            b.currency,
          )}/day → ${formatMoney(projectedOver, b.currency)} by end of month`}
        >
          ON TRACK TO HIT {formatMoney(projectedOver, b.currency)} ·{" "}
          {Math.round(
            ((projectedOver - b.amount) / b.amount) * 100,
          )}
          % OVER
        </div>
      )}
    </div>
  );
}

function formatMoney(n: number, ccy: string): string {
  const sym = ccy === "GBP" ? "£" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : "";
  return sym ? `${sym}${n.toFixed(0)}` : `${n.toFixed(0)} ${ccy}`;
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--ink-3)",
          letterSpacing: "0.6px",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontFamily: "var(--sans)",
  fontSize: 13,
  outline: "none",
};
