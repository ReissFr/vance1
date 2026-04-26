"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDeepLinkFocus } from "@/lib/use-deep-link-focus";

interface Subscription {
  id: string;
  service_name: string;
  amount: number | null;
  currency: string;
  cadence: "weekly" | "monthly" | "quarterly" | "annual" | "unknown";
  status: "active" | "trial" | "cancelled" | "paused" | "unknown";
  next_renewal_date: string | null;
  last_charged_at: string | null;
  category: string | null;
  detection_source: string;
  confidence: number | null;
  user_confirmed: boolean;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

const STATUS_COLOR: Record<Subscription["status"], string> = {
  active: "#10B981",
  trial: "#FBBF24",
  cancelled: "#6B7280",
  paused: "#60A5FA",
  unknown: "#6B7280",
};

// Canonical cancel/manage URLs for common subscription services. When the
// service_name matches (case-insensitive, ignoring spaces), we surface a
// direct link as a fast alternative to the browser-agent cancellation flow.
// Kept tight on purpose — providers rename these URLs, so only track ones
// Reiss is likely to have and we're confident about.
const CANCEL_URLS: Record<string, string> = {
  netflix: "https://www.netflix.com/cancelplan",
  spotify: "https://www.spotify.com/account/subscription/",
  "apple music": "https://tv.apple.com/account/subscriptions",
  "apple tv": "https://tv.apple.com/account/subscriptions",
  icloud: "https://www.apple.com/shop/account/subscriptions",
  "apple one": "https://tv.apple.com/account/subscriptions",
  "amazon prime": "https://www.amazon.co.uk/gp/primecentral",
  disney: "https://www.disneyplus.com/account/subscription",
  "disney+": "https://www.disneyplus.com/account/subscription",
  "youtube premium": "https://www.youtube.com/paid_memberships",
  "youtube music": "https://www.youtube.com/paid_memberships",
  hbo: "https://play.max.com/settings/subscription",
  max: "https://play.max.com/settings/subscription",
  "chatgpt plus": "https://chat.openai.com/#settings",
  "openai plus": "https://chat.openai.com/#settings",
  github: "https://github.com/settings/billing/plans",
  figma: "https://www.figma.com/settings/billing",
  notion: "https://www.notion.so/my-account",
  linear: "https://linear.app/settings/billing",
  dropbox: "https://www.dropbox.com/account/plan",
  "new york times": "https://myaccount.nytimes.com/seg/subscription",
  "nyt": "https://myaccount.nytimes.com/seg/subscription",
};

function cancelUrlFor(serviceName: string): string | null {
  const key = serviceName.trim().toLowerCase();
  if (CANCEL_URLS[key]) return CANCEL_URLS[key];
  const alt = key.replace(/\s+/g, "");
  for (const [k, url] of Object.entries(CANCEL_URLS)) {
    if (k.replace(/\s+/g, "") === alt) return url;
  }
  return null;
}

function money(amount: number | null, ccy: string): string {
  if (amount == null) return "—";
  const sym = ccy === "GBP" ? "£" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : "";
  return sym ? `${sym}${amount.toFixed(2)}` : `${amount.toFixed(2)} ${ccy}`;
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

function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(rows: Subscription[]) {
  const header = [
    "service_name",
    "amount",
    "currency",
    "cadence",
    "monthly_equivalent",
    "status",
    "next_renewal_date",
    "last_charged_at",
    "category",
    "user_confirmed",
    "confidence",
    "notes",
    "first_seen_at",
    "last_seen_at",
  ];
  const lines = [header.join(",")];
  for (const s of rows) {
    lines.push(
      [
        s.service_name,
        s.amount ?? "",
        s.currency,
        s.cadence,
        monthlyEquiv(s.amount, s.cadence)?.toFixed(2) ?? "",
        s.status,
        s.next_renewal_date ?? "",
        s.last_charged_at ?? "",
        s.category ?? "",
        s.user_confirmed ? "1" : "0",
        s.confidence ?? "",
        s.notes ?? "",
        s.first_seen_at,
        s.last_seen_at,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Days since the sub was last seen charging. Prefer last_charged_at, fall
// back to last_seen_at (email detection time). Returns null if we can't
// compute it — e.g. a sub we just discovered.
function daysSinceCharge(s: Subscription): number | null {
  const ref = s.last_charged_at ?? s.last_seen_at;
  if (!ref) return null;
  const t = new Date(ref).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// Only active/trial subs with a charge cadence that SHOULD have fired by
// now are eligible to be called stale. For unknown cadence we can't judge.
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
  const threshold = staleThresholdDays(s.cadence);
  if (threshold == null) return false;
  const days = daysSinceCharge(s);
  return days != null && days >= threshold;
}

function daysUntil(iso: string | null): string {
  if (!iso) return "no date";
  const d = new Date(iso + "T00:00:00Z");
  const diff = Math.round((d.getTime() - Date.now()) / 86400000);
  if (diff < 0) return `${-diff}d ago`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff < 7) return `in ${diff}d`;
  if (diff < 30) return `in ${Math.round(diff / 7)}w`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function SubscriptionsConsole() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all" | "cancelled">("active");
  const { focusId } = useDeepLinkFocus("subscription", { ready: !loading });

  useEffect(() => {
    const urlId = new URLSearchParams(window.location.search).get("id");
    if (urlId) setFilter("all");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter === "cancelled") params.set("status", "cancelled");
      const res = await fetch(
        `/api/subscriptions${params.size ? "?" + params.toString() : ""}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as { subscriptions: Subscription[] };
      let rows = data.subscriptions ?? [];
      if (filter === "active") {
        rows = rows.filter((r) => r.status === "active" || r.status === "trial");
      }
      setSubs(rows);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch("/api/subscriptions/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Subscription scan" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "scan failed");
      }
      setScanMsg(
        "Sweep started — scanning last 90 days of email + bank. Refresh in a moment.",
      );
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  const patch = useCallback(
    async (id: string, body: Partial<Subscription>) => {
      await fetch(`/api/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Remove this subscription from tracking?")) return;
      await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
      await load();
    },
    [load],
  );

  const totals = useMemo(() => {
    const byCurrency: Record<string, number> = {};
    const staleByCurrency: Record<string, number> = {};
    let activeCount = 0;
    let staleCount = 0;
    for (const s of subs) {
      if (s.status !== "active" && s.status !== "trial") continue;
      activeCount += 1;
      const m = monthlyEquiv(s.amount, s.cadence);
      if (m != null) {
        byCurrency[s.currency] = (byCurrency[s.currency] ?? 0) + m;
      }
      if (isStale(s)) {
        staleCount += 1;
        if (m != null) {
          staleByCurrency[s.currency] = (staleByCurrency[s.currency] ?? 0) + m;
        }
      }
    }
    return { byCurrency, activeCount, staleByCurrency, staleCount };
  }, [subs]);

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
            Monthly equivalent
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 30,
              fontStyle: "italic",
              color: "var(--ink)",
              lineHeight: 1,
            }}
          >
            {Object.keys(totals.byCurrency).length === 0
              ? "—"
              : Object.entries(totals.byCurrency)
                  .map(([ccy, v]) => money(v, ccy))
                  .join(" + ")}
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              marginTop: 6,
              letterSpacing: "0.4px",
            }}
          >
            {totals.activeCount} ACTIVE
          </div>
          {totals.staleCount > 0 && (
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "#FBBF24",
                marginTop: 4,
                letterSpacing: "0.4px",
              }}
              title="Active subscriptions that haven't charged within their expected cadence — likely unused. Consider cancelling."
            >
              {totals.staleCount} MAYBE UNUSED
              {Object.keys(totals.staleByCurrency).length > 0 && (
                <>
                  {" · "}
                  {Object.entries(totals.staleByCurrency)
                    .map(([ccy, v]) => money(v, ccy))
                    .join(" + ")}
                  /MO POTENTIAL
                </>
              )}
            </div>
          )}
        </div>

        <button
          onClick={scan}
          disabled={scanning}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "10px 16px",
            background: "var(--indigo-soft)",
            color: "var(--ink)",
            border: "1px solid var(--indigo)",
            borderRadius: 8,
            cursor: scanning ? "wait" : "pointer",
            letterSpacing: "0.6px",
          }}
        >
          {scanning ? "SCANNING…" : "SCAN NOW"}
        </button>
      </div>

      {scanMsg && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-2)",
            marginBottom: 16,
            padding: "8px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--surface)",
          }}
        >
          {scanMsg}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {(["active", "all", "cancelled"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              background: filter === f ? "var(--surface-2)" : "transparent",
              color: filter === f ? "var(--ink)" : "var(--ink-3)",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              padding: "5px 12px",
              letterSpacing: "0.6px",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            {f}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => downloadCsv(subs)}
          disabled={subs.length === 0}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            background: "transparent",
            color: subs.length === 0 ? "var(--ink-4)" : "var(--indigo)",
            border: `1px solid ${subs.length === 0 ? "var(--rule)" : "var(--indigo)"}`,
            borderRadius: 6,
            padding: "5px 12px",
            letterSpacing: "0.6px",
            cursor: subs.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          EXPORT CSV
        </button>
      </div>

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : subs.length === 0 ? (
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
          {filter === "active"
            ? "No active subscriptions yet. Hit SCAN NOW to sweep your email + bank."
            : "Nothing here."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {subs.map((s) => (
            <SubRow
              key={s.id}
              s={s}
              onPatch={(body) => patch(s.id, body)}
              onDelete={() => remove(s.id)}
              isFocused={focusId === s.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubRow({
  s,
  onPatch,
  onDelete,
  isFocused,
}: {
  s: Subscription;
  onPatch: (body: Partial<Subscription>) => void;
  onDelete: () => void;
  isFocused?: boolean;
}) {
  const color = STATUS_COLOR[s.status];
  const isActive = s.status === "active" || s.status === "trial";
  return (
    <div
      data-subscription-id={s.id}
      style={{
        border: `1px solid ${isFocused ? "var(--indigo)" : "var(--rule)"}`,
        borderRadius: 10,
        padding: "12px 16px",
        background: isFocused ? "var(--indigo-soft)" : "var(--surface)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        opacity: isActive ? 1 : 0.6,
        transition: "background 240ms ease, border-color 240ms ease",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          {s.service_name}
          {s.confidence != null && s.confidence < 0.7 && !s.user_confirmed && (
            <span
              style={{
                marginLeft: 8,
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--ink-3)",
                letterSpacing: "0.4px",
              }}
            >
              · GUESS
            </span>
          )}
          {isStale(s) && (
            <span
              style={{
                marginLeft: 8,
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "#FBBF24",
                letterSpacing: "0.4px",
                padding: "1px 6px",
                border: "1px solid #FBBF24",
                borderRadius: 4,
              }}
              title={`No charge seen in ${daysSinceCharge(s)} days — expected every ${s.cadence}. Likely unused.`}
            >
              STALE · {daysSinceCharge(s)}d
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            marginTop: 2,
            letterSpacing: "0.4px",
          }}
        >
          {money(s.amount, s.currency)} / {s.cadence.toUpperCase()}
          {s.next_renewal_date && ` · RENEWS ${daysUntil(s.next_renewal_date)}`}
          {s.category && ` · ${s.category.toUpperCase()}`}
          {isActive && cancelUrlFor(s.service_name) && (
            <>
              {" · "}
              <a
                href={cancelUrlFor(s.service_name)!}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the provider's cancel page — faster than asking JARVIS"
                style={{
                  color: "var(--indigo)",
                  textDecoration: "none",
                  borderBottom: "1px dashed var(--indigo)",
                }}
              >
                CANCEL PAGE ↗
              </a>
            </>
          )}
        </div>
      </div>
      {isActive ? (
        <>
          <a
            href={`/chat?q=${encodeURIComponent(
              `Cancel my ${s.service_name} subscription — log into the provider's site with my credentials, go through their cancellation flow, and confirm when it's done. Current plan: ${money(s.amount, s.currency)} / ${s.cadence}.`,
            )}`}
            title="Have JARVIS cancel it on the provider's site"
            style={pillStyle("var(--indigo)")}
          >
            CANCEL FOR ME
          </a>
          <button
            onClick={() => onPatch({ status: "cancelled" })}
            title="I already cancelled — just update my records"
            style={pillStyle("#F87171")}
          >
            MARK
          </button>
        </>
      ) : (
        <button
          onClick={() => onPatch({ status: "active" })}
          style={pillStyle("#10B981")}
        >
          ACTIVATE
        </button>
      )}
      <button
        onClick={onDelete}
        style={{
          background: "transparent",
          color: "var(--ink-3)",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          padding: "3px 9px",
          fontFamily: "var(--mono)",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}

function pillStyle(color: string): React.CSSProperties {
  return {
    fontFamily: "var(--mono)",
    fontSize: 10.5,
    padding: "5px 10px",
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    borderRadius: 6,
    cursor: "pointer",
    letterSpacing: "0.5px",
    textDecoration: "none",
    display: "inline-block",
  };
}
