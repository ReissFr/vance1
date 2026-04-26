"use client";

import { useCallback, useEffect, useState } from "react";

type HorizonKind =
  | "today" | "tomorrow" | "this_week" | "this_weekend" | "next_week"
  | "this_month" | "next_month" | "soon" | "eventually" | "unspecified";
type Domain =
  | "work" | "health" | "relationships" | "family" | "finance"
  | "creative" | "self" | "spiritual" | "other";
type Status = "pending" | "kept" | "partial" | "broken" | "forgotten" | "dismissed";

type FilterStatus = Status | "pinned" | "archived" | "all";
type FilterHorizon = HorizonKind | "all";
type FilterDomain = Domain | "all";

type Promise = {
  id: string;
  scan_id: string;
  promise_text: string;
  horizon_text: string;
  horizon_kind: HorizonKind;
  domain: Domain;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
  target_date: string;
  confidence: number;
  status: Status;
  resolution_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type DomainRate = { kept: number; total: number; rate: number };

type Stats = {
  total: number;
  pending: number;
  kept: number;
  partial: number;
  broken: number;
  forgotten: number;
  dismissed: number;
  pinned: number;
  overdue_count: number;
  due_today: number;
  due_this_week: number;
  follow_through_rate: number;
  follow_through_loose: number;
  per_domain_rate: Record<string, DomainRate>;
  per_horizon_rate: Record<string, DomainRate>;
  by_domain: Record<string, number>;
  by_horizon: Record<string, number>;
  by_status: Record<string, number>;
};

const HORIZON_LABEL: Record<HorizonKind, string> = {
  today: "TODAY",
  tomorrow: "TOMORROW",
  this_week: "THIS WEEK",
  this_weekend: "THIS WEEKEND",
  next_week: "NEXT WEEK",
  this_month: "THIS MONTH",
  next_month: "NEXT MONTH",
  soon: "SOON",
  eventually: "EVENTUALLY",
  unspecified: "UNSPECIFIED",
};

const HORIZON_COLOR: Record<HorizonKind, string> = {
  today: "#f4577a",
  tomorrow: "#fbb86d",
  this_week: "#fbb86d",
  this_weekend: "#bfd4ee",
  next_week: "#bfd4ee",
  this_month: "#7affcb",
  next_month: "#7affcb",
  soon: "#c9b3f4",
  eventually: "#9aa28e",
  unspecified: "#bfb5a8",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  kept: "#7affcb",
  partial: "#fbb86d",
  broken: "#f4577a",
  forgotten: "#c9b3f4",
  dismissed: "#5a5248",
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  kept: "Kept",
  partial: "Partial",
  broken: "Broken",
  forgotten: "Forgotten",
  dismissed: "Dismissed",
};

const STATUS_BLURB: Record<Status, string> = {
  pending: "still open",
  kept: "you did it",
  partial: "you did some of it",
  broken: "you explicitly chose not to",
  forgotten: "you forgot until prompted",
  dismissed: "false positive from the scan",
};

function relativeDate(iso: string, today: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`).getTime();
  const t = new Date(`${today}T00:00:00Z`).getTime();
  const days = Math.round((d - t) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0 && days < 30) return `in ${days}d`;
  if (days < 0 && days > -30) return `${Math.abs(days)}d overdue`;
  if (days > 0 && days < 365) return `in ${Math.round(days / 30)}mo`;
  if (days < 0 && days > -365) return `${Math.round(Math.abs(days) / 30)}mo overdue`;
  if (days > 0) return `in ${(days / 365).toFixed(1)}y`;
  return `${(Math.abs(days) / 365).toFixed(1)}y overdue`;
}

function spokenAgo(iso: string, today: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`).getTime();
  const t = new Date(`${today}T00:00:00Z`).getTime();
  const days = Math.round((t - d) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export function SaidIWouldConsole() {
  const [rows, setRows] = useState<Promise[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [today, setToday] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [horizonFilter, setHorizonFilter] = useState<FilterHorizon>("all");
  const [domainFilter, setDomainFilter] = useState<FilterDomain>("all");
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);
  const [dueWithin, setDueWithin] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; skipped?: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [windowDays, setWindowDays] = useState<number>(30);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"kept" | "partial" | "broken" | "forgotten" | "dismiss">("kept");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter === "pinned") params.set("pinned", "true");
      else if (statusFilter !== "all") {
        if (statusFilter === "archived") {
          params.set("include_archived", "true");
        } else {
          params.set("status", statusFilter);
        }
      } else {
        params.set("include_archived", "true");
      }
      if (horizonFilter !== "all") params.set("horizon_kind", horizonFilter);
      if (domainFilter !== "all") params.set("domain", domainFilter);
      if (overdueOnly) params.set("overdue", "true");
      if (dueWithin > 0) params.set("due_within", String(dueWithin));
      params.set("limit", "200");

      const r = await fetch(`/api/said-i-would?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { promises: Promise[]; stats: Stats; today: string };
      setRows(j.promises);
      setStats(j.stats);
      setToday(j.today);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, horizonFilter, domainFilter, overdueOnly, dueWithin]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/said-i-would/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; skipped?: number; latency_ms?: number; signals?: Record<string, number> };
      setScanResult({ inserted: j.inserted, skipped: j.skipped, latency_ms: j.latency_ms, signals: j.signals });
      setStatusFilter("pending");
      await load();
      setTimeout(() => setScanResult(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/said-i-would/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.text();
        throw new Error(`HTTP ${r.status}: ${e.slice(0, 200)}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submitResolve = async (p: Promise) => {
    setError(null);
    const body: Record<string, unknown> = { action: resolveMode };
    if (resolveNote.trim()) body.resolution_note = resolveNote.trim();
    await patch(p.id, body);
    setResolveOpenId(null);
    setResolveNote("");
  };

  const resolveColor = (m: "kept" | "partial" | "broken" | "forgotten" | "dismiss"): string =>
    m === "kept" ? "#7affcb"
      : m === "partial" ? "#fbb86d"
      : m === "broken" ? "#f4577a"
      : m === "forgotten" ? "#c9b3f4"
      : "#5a5248";

  const sortedDomainRates = stats
    ? Object.entries(stats.per_domain_rate).sort(([, a], [, b]) => b.total - a.total).slice(0, 5)
    : [];

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} promises · ${stats.pending} pending · ${stats.overdue_count} overdue · follow-through ${stats.follow_through_rate}%` : ""}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
            style={{ background: "#1a1612", border: "1px solid #2a2620", color: "#e8e0d2", padding: "6px 10px", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" }}
          >
            <option value={7}>7d window</option>
            <option value={14}>14d window</option>
            <option value={30}>30d window</option>
            <option value={60}>60d window</option>
            <option value={90}>90d window</option>
          </select>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{ background: scanning ? "#2a2620" : "#7affcb", color: scanning ? "#8a8378" : "#0f0d0a", border: "none", padding: "8px 18px", fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 600, cursor: scanning ? "default" : "pointer" }}
          >
            {scanning ? "Mining promises..." : "Mine for promises"}
          </button>
        </div>
      </div>

      {scanResult && (
        <div style={{ background: "#1a1612", border: "1px solid #2a2620", borderLeft: "3px solid #7affcb", padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#bfb5a8", letterSpacing: 1.2 }}>
          {scanResult.inserted} new · {scanResult.skipped ?? 0} skipped (already extracted){scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}{scanResult.signals ? ` · sampled ${scanResult.signals.sampled} of ${scanResult.signals.candidates} candidates` : ""}
        </div>
      )}

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 12 }}>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #f4577a" }}>
            <div style={{ fontSize: 9, color: "#f4577a", letterSpacing: 1.4, textTransform: "uppercase" }}>Overdue</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.overdue_count}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>pending past their target date</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #fbb86d" }}>
            <div style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>Due this week</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.due_this_week}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>{stats.due_today} due today</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #7affcb" }}>
            <div style={{ fontSize: 9, color: "#7affcb", letterSpacing: 1.4, textTransform: "uppercase" }}>Follow-through</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.follow_through_rate}%</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>kept / resolved · loose: {stats.follow_through_loose}%</div>
          </div>
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", borderLeft: "3px solid #c9b3f4" }}>
            <div style={{ fontSize: 9, color: "#c9b3f4", letterSpacing: 1.4, textTransform: "uppercase" }}>Resolved</div>
            <div style={{ fontSize: 28, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", marginTop: 2 }}>{stats.kept + stats.partial + stats.broken + stats.forgotten}</div>
            <div style={{ fontSize: 9, color: "#5a5248", marginTop: 4, fontStyle: "italic" }}>{stats.kept} kept · {stats.partial} partial · {stats.broken} broken · {stats.forgotten} forgotten</div>
          </div>
        </div>
      )}

      {stats && sortedDomainRates.length > 0 && (
        <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "12px 14px", marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8 }}>Follow-through by domain</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sortedDomainRates.map(([domain, r]) => (
              <div key={domain} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 100, fontSize: 10, color: "#bfb5a8", letterSpacing: 1.2, textTransform: "uppercase" }}>{domain}</div>
                <div style={{ flex: 1, height: 6, background: "#2a2620", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                  <div style={{ height: "100%", background: r.rate >= 70 ? "#7affcb" : r.rate >= 40 ? "#fbb86d" : "#f4577a", width: `${Math.max(2, r.rate)}%`, transition: "width 0.3s" }} />
                </div>
                <div style={{ width: 80, fontSize: 11, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", textAlign: "right" }}>
                  {r.rate}% <span style={{ color: "#5a5248", fontSize: 9 }}>({r.kept}/{r.total})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Status:</span>
        {(["pending", "kept", "partial", "broken", "forgotten", "dismissed", "pinned", "archived", "all"] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setOverdueOnly(false); setDueWithin(0); }}
            style={{ background: statusFilter === s ? "#2a2620" : "transparent", border: `1px solid ${statusFilter === s ? "#5a5248" : "#2a2620"}`, color: statusFilter === s ? "#e8e0d2" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Quick:</span>
        <button
          onClick={() => { setOverdueOnly(true); setDueWithin(0); setStatusFilter("pending"); }}
          style={{ background: overdueOnly ? "#2a2620" : "transparent", border: `1px solid ${overdueOnly ? "#f4577a" : "#2a2620"}`, color: overdueOnly ? "#f4577a" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
        >
          Overdue only
        </button>
        <button
          onClick={() => { setDueWithin(7); setOverdueOnly(false); setStatusFilter("pending"); }}
          style={{ background: dueWithin === 7 ? "#2a2620" : "transparent", border: `1px solid ${dueWithin === 7 ? "#fbb86d" : "#2a2620"}`, color: dueWithin === 7 ? "#fbb86d" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
        >
          Due in 7d
        </button>
        <button
          onClick={() => { setDueWithin(30); setOverdueOnly(false); setStatusFilter("pending"); }}
          style={{ background: dueWithin === 30 ? "#2a2620" : "transparent", border: `1px solid ${dueWithin === 30 ? "#fbb86d" : "#2a2620"}`, color: dueWithin === 30 ? "#fbb86d" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
        >
          Due in 30d
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Horizon:</span>
        {(["all", "today", "tomorrow", "this_week", "this_weekend", "next_week", "this_month", "next_month", "soon", "eventually", "unspecified"] as FilterHorizon[]).map((h) => (
          <button
            key={h}
            onClick={() => setHorizonFilter(h)}
            style={{ background: horizonFilter === h ? "#2a2620" : "transparent", border: `1px solid ${horizonFilter === h ? (h === "all" ? "#5a5248" : HORIZON_COLOR[h as HorizonKind]) : "#2a2620"}`, color: horizonFilter === h ? (h === "all" ? "#e8e0d2" : HORIZON_COLOR[h as HorizonKind]) : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {h.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>Domain:</span>
        {(["all", "work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"] as FilterDomain[]).map((d) => (
          <button
            key={d}
            onClick={() => setDomainFilter(d)}
            style={{ background: domainFilter === d ? "#2a2620" : "transparent", border: `1px solid ${domainFilter === d ? "#5a5248" : "#2a2620"}`, color: domainFilter === d ? "#e8e0d2" : "#8a8378", padding: "5px 11px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
          >
            {d}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: "#1a1612", border: "1px solid #f4577a", color: "#f4577a", padding: "10px 14px", marginBottom: 14, fontSize: 11, letterSpacing: 1.2 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 11, color: "#5a5248", letterSpacing: 1.4, textTransform: "uppercase" }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "#1a1612", border: "1px solid #2a2620", padding: "30px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#8a8378", fontStyle: "italic", marginBottom: 8 }}>
            No promises match these filters yet.
          </div>
          <div style={{ fontSize: 11, color: "#5a5248", letterSpacing: 1.2 }}>
            Run "Mine for promises" to extract casual "I'll" statements from your recent chats.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((p) => {
            const horizonColor = HORIZON_COLOR[p.horizon_kind];
            const statusColor = STATUS_COLOR[p.status];
            const isResolving = resolveOpenId === p.id;
            const isOverdue = p.status === "pending" && p.target_date < today;
            return (
              <div
                key={p.id}
                style={{ background: "#1a1612", border: "1px solid #2a2620", borderLeft: `3px solid ${statusColor}`, padding: "14px 16px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 9, color: horizonColor, letterSpacing: 1.4, textTransform: "uppercase", border: `1px solid ${horizonColor}33`, padding: "2px 6px" }}>
                        {HORIZON_LABEL[p.horizon_kind]}
                      </span>
                      <span style={{ fontSize: 9, color: "#8a8378", letterSpacing: 1.2, textTransform: "uppercase" }}>
                        {p.domain}
                      </span>
                      {p.pinned && (
                        <span style={{ fontSize: 9, color: "#fbb86d", letterSpacing: 1.4, textTransform: "uppercase" }}>● pinned</span>
                      )}
                      <span style={{ fontSize: 9, color: statusColor, letterSpacing: 1.4, textTransform: "uppercase" }}>
                        {STATUS_LABEL[p.status]}
                      </span>
                      {isOverdue && (
                        <span style={{ fontSize: 9, color: "#f4577a", letterSpacing: 1.4, textTransform: "uppercase", border: "1px solid #f4577a44", padding: "2px 6px" }}>
                          OVERDUE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 17, color: "#e8e0d2", fontFamily: "Georgia, ui-serif, serif", fontStyle: "italic", lineHeight: 1.35 }}>
                      {p.promise_text}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 10, color: "#8a8378", letterSpacing: 1.1, marginBottom: 8 }}>
                  <span>said <span style={{ color: "#bfb5a8" }}>{spokenAgo(p.spoken_date, today)}</span></span>
                  {p.horizon_text && (
                    <span>horizon <span style={{ color: "#bfb5a8", fontStyle: "italic" }}>"{p.horizon_text}"</span></span>
                  )}
                  <span>target <span style={{ color: isOverdue ? "#f4577a" : "#bfb5a8" }}>{relativeDate(p.target_date, today)}</span></span>
                </div>

                {p.resolution_note && (
                  <div style={{ background: "#0f0d0a", border: `1px solid ${statusColor}33`, padding: "8px 12px", marginBottom: 8, fontSize: 12, color: "#bfb5a8", fontStyle: "italic", lineHeight: 1.4 }}>
                    <span style={{ fontSize: 8, color: statusColor, letterSpacing: 1.4, textTransform: "uppercase", display: "block", marginBottom: 2 }}>{STATUS_LABEL[p.status]} note</span>
                    {p.resolution_note}
                  </div>
                )}

                {!isResolving ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {p.status === "pending" ? (
                      <>
                        <button
                          onClick={() => { setResolveOpenId(p.id); setResolveMode("kept"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #7affcb55", color: "#7affcb", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Kept
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(p.id); setResolveMode("partial"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #fbb86d55", color: "#fbb86d", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Partial
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(p.id); setResolveMode("broken"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #f4577a55", color: "#f4577a", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Broken
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(p.id); setResolveMode("forgotten"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #c9b3f455", color: "#c9b3f4", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Forgotten
                        </button>
                        <button
                          onClick={() => { setResolveOpenId(p.id); setResolveMode("dismiss"); setResolveNote(""); }}
                          style={{ background: "transparent", border: "1px solid #5a524855", color: "#8a8378", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => void patch(p.id, { action: "reschedule", days: 7 })}
                          style={{ background: "transparent", border: "1px solid #2a2620", color: "#8a8378", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                        >
                          +7d
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => void patch(p.id, { action: "unresolve" })}
                        style={{ background: "transparent", border: "1px solid #5a524855", color: "#bfb5a8", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        Unresolve
                      </button>
                    )}
                    <button
                      onClick={() => void patch(p.id, { action: p.pinned ? "unpin" : "pin" })}
                      style={{ background: "transparent", border: `1px solid ${p.pinned ? "#fbb86d55" : "#2a2620"}`, color: p.pinned ? "#fbb86d" : "#8a8378", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer", marginLeft: "auto" }}
                    >
                      {p.pinned ? "Unpin" : "Pin"}
                    </button>
                    {p.archived_at ? (
                      <button
                        onClick={() => void patch(p.id, { action: "restore" })}
                        style={{ background: "transparent", border: "1px solid #2a2620", color: "#bfb5a8", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => void patch(p.id, { action: "archive" })}
                        style={{ background: "transparent", border: "1px solid #2a2620", color: "#8a8378", padding: "5px 10px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ background: "#0f0d0a", border: `1px solid ${resolveColor(resolveMode)}55`, padding: "12px 14px", marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: resolveColor(resolveMode), letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>
                      Mark as {resolveMode}
                    </div>
                    <div style={{ fontSize: 11, color: "#8a8378", marginBottom: 10, fontStyle: "italic" }}>
                      {STATUS_BLURB[resolveMode === "dismiss" ? "dismissed" : resolveMode]}
                    </div>
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder={
                        resolveMode === "kept" ? "optional note (how it went)"
                          : resolveMode === "partial" ? "optional note (what got done, what didn't)"
                          : resolveMode === "broken" ? "optional note (why you chose not to)"
                          : resolveMode === "forgotten" ? "optional note (what got in the way)"
                          : "optional note (why dismiss)"
                      }
                      style={{ width: "100%", minHeight: 60, background: "#1a1612", border: "1px solid #2a2620", color: "#e8e0d2", padding: "8px 10px", fontSize: 12, fontFamily: "Georgia, ui-serif, serif", lineHeight: 1.4, resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => void submitResolve(p)}
                        style={{ background: resolveColor(resolveMode), color: "#0f0d0a", border: "none", padding: "6px 14px", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 600, cursor: "pointer" }}
                      >
                        Confirm {resolveMode}
                      </button>
                      <button
                        onClick={() => { setResolveOpenId(null); setResolveNote(""); }}
                        style={{ background: "transparent", border: "1px solid #2a2620", color: "#8a8378", padding: "6px 14px", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
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
