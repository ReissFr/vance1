"use client";

import { useCallback, useEffect, useState } from "react";
import { useDeepLinkFocus } from "@/lib/use-deep-link-focus";

interface Receipt {
  id: string;
  merchant: string;
  amount: number | null;
  currency: string;
  purchased_at: string | null;
  category: string | null;
  description: string | null;
  order_ref: string | null;
  confidence: number | null;
  archived: boolean;
  created_at: string;
}

const CATEGORY_COLOR: Record<string, string> = {
  groceries: "#7affcb",
  takeaway: "#ff9eb5",
  electronics: "#7a8fff",
  travel: "#c49cff",
  fashion: "#ffb27a",
  books: "#f5dc7a",
  home: "#9effd4",
  other: "#a5a5a5",
};

const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

function formatAmount(amount: number | null, currency: string): string {
  if (amount == null) return "—";
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${sym}${amount.toFixed(2)}`;
}

function monthBucket(iso: string | null): string {
  if (!iso) return "undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "undated";
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(rows: Receipt[]) {
  const header = [
    "purchased_at",
    "merchant",
    "amount",
    "currency",
    "category",
    "description",
    "order_ref",
    "archived",
    "created_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.purchased_at ?? "",
        r.merchant,
        r.amount ?? "",
        r.currency,
        r.category ?? "",
        r.description ?? "",
        r.order_ref ?? "",
        r.archived ? "1" : "0",
        r.created_at,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReceiptsConsole() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeMerchant, setActiveMerchant] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeMsg, setCategorizeMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showDupesOnly, setShowDupesOnly] = useState(false);
  const { focusId } = useDeepLinkFocus("receipt", { ready: !loading });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get("id");
    const urlCategory = params.get("category");
    if (urlId) {
      setActiveCategory(null);
    } else if (urlCategory) {
      setActiveCategory(urlCategory.toLowerCase());
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        archived: String(showArchived),
        limit: "300",
      });
      if (activeCategory) params.set("category", activeCategory);
      const res = await fetch(`/api/receipts?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as { receipts: Receipt[] };
      setReceipts(data.receipts ?? []);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch("/api/receipts/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Receipts scan" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "scan failed");
      }
      setScanMsg("Sweep started — scanning last 60 days of email. Refresh in a moment.");
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  const archive = useCallback(
    async (id: string, archived: boolean) => {
      await fetch(`/api/receipts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      setReceipts((rs) => rs.filter((r) => r.id !== id));
    },
    [],
  );

  const confirm = useCallback(async (id: string) => {
    await fetch(`/api/receipts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_confirmed: true }),
    });
  }, []);

  const autoCategorize = useCallback(async () => {
    setCategorizing(true);
    setCategorizeMsg(null);
    try {
      const res = await fetch("/api/receipts/auto-categorize", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        categorized?: number;
        scanned?: number;
        remaining?: number;
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "auto-categorize failed");
      const count = body.categorized ?? 0;
      const remaining = body.remaining ?? 0;
      setCategorizeMsg(
        count === 0
          ? "Nothing categorized — merchants too ambiguous."
          : `Categorized ${count}${remaining > 0 ? ` · ${remaining} left` : ""}.`,
      );
      await load();
    } catch (e) {
      setCategorizeMsg(e instanceof Error ? e.message : "auto-categorize failed");
    } finally {
      setCategorizing(false);
    }
  }, [load]);

  const setCategory = useCallback(async (id: string, category: string | null) => {
    setReceipts((rs) => rs.map((r) => (r.id === id ? { ...r, category } : r)));
    await fetch(`/api/receipts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category }),
    });
  }, []);

  const qLower = query.trim().toLowerCase();
  const merchantFiltered = activeMerchant
    ? receipts.filter(
        (r) => r.merchant.toLowerCase() === activeMerchant.toLowerCase(),
      )
    : receipts;
  const filtered = qLower
    ? merchantFiltered.filter(
        (r) =>
          r.merchant.toLowerCase().includes(qLower) ||
          (r.description ?? "").toLowerCase().includes(qLower) ||
          (r.order_ref ?? "").toLowerCase().includes(qLower) ||
          (r.category ?? "").toLowerCase().includes(qLower),
      )
    : merchantFiltered;

  // Potential duplicate detection over the full loaded set: same merchant
  // (case-insensitive, whitespace-normalized), same amount, same currency,
  // within 7 days. Surfaces pairs like Uber double-charges or retry-then-
  // refunded orders that need review.
  const potentialDupeIds = new Set<string>();
  {
    const dupeBuckets = new Map<string, Receipt[]>();
    for (const r of receipts) {
      if (r.archived || r.amount == null || !r.purchased_at) continue;
      const merchantKey = r.merchant.toLowerCase().replace(/\s+/g, "");
      const key = `${merchantKey}|${r.amount.toFixed(2)}|${r.currency}`;
      const arr = dupeBuckets.get(key) ?? [];
      arr.push(r);
      dupeBuckets.set(key, arr);
    }
    for (const [, arr] of dupeBuckets) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => (a.purchased_at ?? "").localeCompare(b.purchased_at ?? ""));
      for (let i = 0; i < arr.length; i += 1) {
        for (let j = i + 1; j < arr.length; j += 1) {
          const a = arr[i];
          const b = arr[j];
          if (!a || !b || !a.purchased_at || !b.purchased_at) continue;
          const deltaDays = Math.abs(
            (new Date(a.purchased_at).getTime() - new Date(b.purchased_at).getTime()) /
              86400000,
          );
          if (deltaDays <= 7) {
            potentialDupeIds.add(a.id);
            potentialDupeIds.add(b.id);
          } else {
            break;
          }
        }
      }
    }
  }

  const finalFiltered = showDupesOnly
    ? filtered.filter((r) => potentialDupeIds.has(r.id))
    : filtered;

  // Top merchants by spend, using the dominant currency across the loaded
  // receipts so the bars are comparable.
  const spendByCurrency: Record<string, number> = {};
  for (const r of receipts) {
    if (r.amount != null) {
      spendByCurrency[r.currency] = (spendByCurrency[r.currency] ?? 0) + r.amount;
    }
  }
  const dominantCurrency = Object.entries(spendByCurrency).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  const merchantSpend: Record<string, number> = {};
  for (const r of receipts) {
    if (r.amount != null && r.currency === dominantCurrency && !r.archived) {
      const key = r.merchant;
      merchantSpend[key] = (merchantSpend[key] ?? 0) + r.amount;
    }
  }
  const topMerchants = Object.entries(merchantSpend)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const topMerchantMax = topMerchants[0]?.[1] ?? 0;

  // Aggregate category counts + totals by currency from the currently-loaded set.
  const categoryCounts: Record<string, number> = {};
  const totalsByCurrency: Record<string, number> = {};
  for (const r of finalFiltered) {
    const cat = r.category ?? "other";
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    if (r.amount != null) {
      totalsByCurrency[r.currency] = (totalsByCurrency[r.currency] ?? 0) + r.amount;
    }
  }

  // Count uncategorized in the full loaded set (not just the filtered view),
  // so the AUTO-CATEGORIZE pill reflects the real backlog regardless of which
  // category chip is active.
  const uncategorizedCount = receipts.filter((r) => !r.category && !r.archived).length;

  // Group receipts by month bucket (in display order — already sorted desc).
  const buckets: { label: string; rows: Receipt[] }[] = [];
  for (const r of finalFiltered) {
    const label = monthBucket(r.purchased_at);
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) {
      last.rows.push(r);
    } else {
      buckets.push({ label, rows: [r] });
    }
  }

  const categories = Object.keys(categoryCounts).sort();

  const DEFAULT_CATEGORIES = [
    "groceries",
    "takeaway",
    "dining",
    "travel",
    "transport",
    "fashion",
    "electronics",
    "books",
    "home",
    "subscriptions",
    "utilities",
    "health",
    "entertainment",
    "other",
  ];
  const knownCategories = Array.from(
    new Set([
      ...receipts.map((r) => r.category).filter((c): c is string => !!c),
      ...DEFAULT_CATEGORIES,
    ]),
  ).sort();

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 960 }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: 18,
          marginBottom: 22,
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 4,
            }}
          >
            Email sweep
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            Scan the last 60 days of email for one-off purchases — Amazon, Uber Eats, flights, shop orders.
          </div>
          {scanMsg && (
            <div
              style={{
                marginTop: 8,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: scanMsg.includes("fail") ? "#ff6b6b" : "var(--indigo)",
                letterSpacing: "0.3px",
              }}
            >
              {scanMsg}
            </div>
          )}
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          style={{
            padding: "10px 22px",
            borderRadius: 10,
            background: "var(--ink)",
            color: "#000",
            border: "none",
            fontFamily: "var(--sans)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            opacity: scanning ? 0.5 : 1,
          }}
        >
          {scanning ? "Queuing…" : "Scan last 60d"}
        </button>
      </div>

      {topMerchants.length >= 3 && dominantCurrency && (
        <div
          style={{
            marginBottom: 16,
            padding: "14px 16px",
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "1.6px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 10,
            }}
          >
            Top merchants · {dominantCurrency}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {topMerchants.map(([merchant, total]) => {
              const active = activeMerchant?.toLowerCase() === merchant.toLowerCase();
              const width = topMerchantMax > 0 ? (total / topMerchantMax) * 100 : 0;
              return (
                <button
                  key={merchant}
                  onClick={() =>
                    setActiveMerchant((cur) =>
                      cur?.toLowerCase() === merchant.toLowerCase() ? null : merchant,
                    )
                  }
                  title={active ? "Click to clear merchant filter" : `Filter to ${merchant}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr auto",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    background: active ? "var(--surface-2, rgba(124,134,255,0.08))" : "transparent",
                    border: active ? "1px solid var(--indigo)" : "1px solid transparent",
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "var(--sans)",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: active ? "var(--ink)" : "var(--ink-2)",
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {merchant}
                  </span>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: "rgba(124,134,255,0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${width}%`,
                        height: "100%",
                        background: active ? "var(--indigo)" : "var(--indigo-soft, #7a8fff)",
                        opacity: active ? 1 : 0.55,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--ink-3)",
                      letterSpacing: "0.3px",
                      minWidth: 60,
                      textAlign: "right",
                    }}
                  >
                    {formatAmount(total, dominantCurrency)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {Object.keys(totalsByCurrency).length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          {Object.entries(totalsByCurrency).map(([cur, total]) => (
            <div
              key={cur}
              style={{
                padding: "10px 16px",
                background: "var(--surface)",
                border: "1px solid var(--rule)",
                borderRadius: 10,
                minWidth: 140,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "1.2px",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  marginBottom: 2,
                }}
              >
                Total · {cur}
              </div>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: 20,
                  color: "var(--ink)",
                }}
              >
                {formatAmount(total, cur)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant, description, order…"
          style={{
            flex: 1,
            minWidth: 220,
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--sans)",
            fontSize: 13,
            outline: "none",
          }}
        />
        {uncategorizedCount > 0 && (
          <button
            onClick={autoCategorize}
            disabled={categorizing}
            title="Let JARVIS categorize them — up to 60 at a time."
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "8px 14px",
              background: "transparent",
              color: "var(--violet)",
              border: "1px solid var(--violet)",
              borderRadius: 8,
              cursor: categorizing ? "wait" : "pointer",
              letterSpacing: "0.6px",
              opacity: categorizing ? 0.5 : 1,
            }}
          >
            {categorizing ? "CATEGORIZING…" : `AUTO-CATEGORIZE · ${uncategorizedCount}`}
          </button>
        )}
        <button
          onClick={() => downloadCsv(finalFiltered)}
          disabled={finalFiltered.length === 0}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "8px 14px",
            background: "transparent",
            color: finalFiltered.length === 0 ? "var(--ink-4)" : "var(--indigo)",
            border: `1px solid ${finalFiltered.length === 0 ? "var(--rule)" : "var(--indigo)"}`,
            borderRadius: 8,
            cursor: finalFiltered.length === 0 ? "not-allowed" : "pointer",
            letterSpacing: "0.6px",
          }}
        >
          EXPORT CSV
        </button>
      </div>
      {categorizeMsg && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: categorizeMsg.toLowerCase().includes("fail")
              ? "#ff6b6b"
              : "var(--violet)",
            letterSpacing: "0.3px",
            marginTop: -4,
            marginBottom: 12,
          }}
        >
          {categorizeMsg}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        <FilterPill
          label={`All · ${finalFiltered.length}`}
          active={activeCategory === null}
          onClick={() => setActiveCategory(null)}
        />
        {categories.map((c) => (
          <FilterPill
            key={c}
            label={`${c} · ${categoryCounts[c] ?? 0}`}
            active={activeCategory === c}
            onClick={() => setActiveCategory(c)}
            color={CATEGORY_COLOR[c] ?? "#a5a5a5"}
          />
        ))}
        <div style={{ flex: 1 }} />
        {potentialDupeIds.size > 0 && (
          <FilterPill
            label={`Dupes? · ${potentialDupeIds.size}`}
            active={showDupesOnly}
            onClick={() => setShowDupesOnly((v) => !v)}
            color="#FBBF24"
          />
        )}
        <FilterPill
          label={showArchived ? "Archived" : "Active"}
          active={showArchived}
          onClick={() => setShowArchived((v) => !v)}
        />
      </div>

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : finalFiltered.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
            border: "1px dashed var(--rule)",
            borderRadius: 14,
          }}
        >
          {qLower
            ? `No receipts match "${query}".`
            : showArchived
            ? "Nothing archived yet."
            : "No receipts tracked yet. Run a scan to sweep your email."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {buckets.map((b) => (
            <div key={b.label}>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  letterSpacing: "1.6px",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  marginBottom: 10,
                }}
              >
                {b.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {b.rows.map((r) => (
                  <ReceiptRow
                    key={r.id}
                    r={r}
                    onArchive={() => archive(r.id, !showArchived)}
                    onConfirm={() => confirm(r.id)}
                    onCategory={(cat) => setCategory(r.id, cat)}
                    knownCategories={knownCategories}
                    isFocused={focusId === r.id}
                    isPotentialDupe={potentialDupeIds.has(r.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
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
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 11.5,
        fontFamily: "var(--sans)",
        border: `1px solid ${active ? (color ?? "var(--ink)") : "var(--rule)"}`,
        background: active ? (color ? `${color}22` : "var(--surface-2)") : "transparent",
        color: active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
        textTransform: "capitalize",
      }}
    >
      {label}
    </button>
  );
}

function ReceiptRow({
  r,
  onArchive,
  onConfirm,
  onCategory,
  knownCategories,
  isFocused,
  isPotentialDupe,
}: {
  r: Receipt;
  onArchive: () => void;
  onConfirm: () => void;
  onCategory: (cat: string | null) => void;
  knownCategories: string[];
  isFocused?: boolean;
  isPotentialDupe?: boolean;
}) {
  const cat = r.category ?? "other";
  const color = CATEGORY_COLOR[cat] ?? "#a5a5a5";
  return (
    <div
      data-receipt-id={r.id}
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        padding: "12px 16px",
        background: isFocused ? "var(--indigo-soft)" : "var(--surface)",
        border: `1px solid ${isFocused ? "var(--indigo)" : "var(--rule)"}`,
        borderRadius: 12,
        transition: "background 240ms ease, border-color 240ms ease",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "baseline",
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              color: "var(--ink)",
              fontWeight: 500,
            }}
          >
            {r.merchant}
          </span>
          {isPotentialDupe && (
            <span
              title="Matches another receipt within 7 days (same merchant + amount). Review — possible double charge."
              style={{
                fontFamily: "var(--mono)",
                fontSize: 9.5,
                color: "#FBBF24",
                letterSpacing: "0.5px",
                padding: "1px 6px",
                border: "1px solid #FBBF24",
                borderRadius: 4,
              }}
            >
              DUPE?
            </span>
          )}
          <select
            value={cat}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__clear__") onCategory(null);
              else if (v === "__new__") {
                const name = window.prompt("New category name?");
                if (name && name.trim()) onCategory(name.trim().toLowerCase());
              } else onCategory(v);
            }}
            title="Change category"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: color,
              background: "transparent",
              border: "1px dashed var(--rule)",
              borderRadius: 4,
              padding: "1px 4px",
              textTransform: "uppercase",
              letterSpacing: "0.4px",
              cursor: "pointer",
              appearance: "none",
              WebkitAppearance: "none",
            }}
          >
            {!knownCategories.includes(cat) && <option value={cat}>{cat}</option>}
            {knownCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__new__">+ new category…</option>
            {r.category && <option value="__clear__">− clear</option>}
          </select>
        </div>
        {r.description && (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.45,
            }}
          >
            {r.description}
          </div>
        )}
        <div
          style={{
            marginTop: 4,
            display: "flex",
            gap: 12,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
          }}
        >
          <span>{shortDate(r.purchased_at)}</span>
          {r.order_ref && <span>#{r.order_ref}</span>}
          {r.confidence != null && r.confidence < 0.75 && (
            <span style={{ color: "#ffb27a" }}>
              LOW · {Math.round(r.confidence * 100)}%
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 17,
          color: "var(--ink)",
          minWidth: 80,
          textAlign: "right",
        }}
      >
        {formatAmount(r.amount, r.currency)}
      </div>
      <button
        onClick={onConfirm}
        title="Mark confirmed"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          background: "transparent",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          padding: "4px 8px",
          cursor: "pointer",
          letterSpacing: "0.4px",
        }}
      >
        OK
      </button>
      <button
        onClick={onArchive}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          background: "transparent",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          padding: "4px 8px",
          cursor: "pointer",
          letterSpacing: "0.4px",
        }}
      >
        {r.archived ? "RESTORE" : "ARCHIVE"}
      </button>
    </div>
  );
}
