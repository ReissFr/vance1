"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

const MINT = "#7affcb";
const SALMON = "#f4577a";
const AMBER = "#fbb86d";
const PEACH = "#f4a8a8";
const SAGE = "#9aa28e";
const LAVENDER = "#c9b3f4";
const BLUE = "#bfd4ee";
const TAUPE = "#bfb5a8";
const BONE = "#bfb5a8";

type Tier = "auto" | "notify" | "approve";
type DecisionStatus = "proposed" | "auto_executed" | "notified" | "queued" | "approved" | "rejected" | "overridden" | "executed" | "failed" | "cancelled";

type ExecutionStatus = "pending" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";

type Decision = {
  id: string;
  kind: string;
  title: string;
  body: string;
  reasoning: string | null;
  signals_consulted: unknown;
  estimated_spend_pence: number;
  actual_spend_pence?: number;
  confidence: number;
  tier: Tier;
  status: DecisionStatus;
  execution_task_id?: string | null;
  execution_status?: ExecutionStatus | null;
  outcome_note: string | null;
  outcome_postmortem_due_at: string | null;
  executed_at: string | null;
  user_responded_at: string | null;
  user_response_note: string | null;
  created_at: string;
};

type Signal = {
  id: string;
  kind: string;
  body: string;
  source: string | null;
  weight: number;
  processed_at: string | null;
  resulted_in_decision_id: string | null;
  captured_at: string;
};

type MetricRow = {
  id: string;
  metric_kind: string;
  value: number;
  unit: string | null;
  note: string | null;
  captured_for_date: string;
  captured_at: string;
};

type DecisionMatrix = {
  auto: { max_spend_pence: number; kinds: string[] };
  notify: { max_spend_pence: number; kinds: string[] };
  approve: { kinds: string[] };
};

type Autonomy = "manual" | "supervised" | "autonomous" | "full_autopilot";

type Venture = {
  id: string;
  name: string;
  thesis: string;
  status: "researching" | "validated" | "building" | "launched" | "scaling" | "paused" | "killed";
  autonomy?: Autonomy;
  paused_at?: string | null;
  budget_pence: number;
  spent_pence: number;
  kill_criteria: string | null;
  decision_matrix: DecisionMatrix;
  operator_memory: string | null;
  thesis_revision: number;
  cadence: "daily" | "twice_daily" | "hourly" | "weekly" | "manual";
  next_heartbeat_at: string | null;
  last_heartbeat_at: string | null;
  launched_at: string | null;
  killed_at: string | null;
  killed_reason: string | null;
  created_at: string;
  updated_at: string;
};

type Detail = {
  venture: Venture;
  decisions: Decision[];
  signals: Signal[];
  metrics: MetricRow[];
};

const STATUS_COLOR: Record<string, string> = {
  researching: BLUE, validated: LAVENDER, building: AMBER, launched: MINT, scaling: MINT, paused: TAUPE, killed: SALMON,
};
const STATUS_LABEL: Record<string, string> = {
  researching: "RESEARCHING", validated: "VALIDATED", building: "BUILDING", launched: "LAUNCHED", scaling: "SCALING", paused: "PAUSED", killed: "KILLED",
};
const TIER_COLOR: Record<Tier, string> = { auto: SAGE, notify: BLUE, approve: AMBER };
const DECISION_STATUS_COLOR: Record<DecisionStatus, string> = {
  proposed: TAUPE, auto_executed: SAGE, notified: BLUE, queued: AMBER,
  approved: MINT, rejected: SALMON, overridden: PEACH, executed: MINT,
  failed: SALMON, cancelled: TAUPE,
};

const SIGNAL_KIND_COLOR: Record<string, string> = {
  customer_email: BLUE, support_ticket: AMBER, churn_event: SALMON,
  competitor_move: PEACH, metric_anomaly: SALMON, calendar_conflict: TAUPE,
  review: LAVENDER, feature_request: MINT, cancellation_reason: SALMON,
  press_mention: LAVENDER, social_mention: BLUE, other: TAUPE,
};
const SIGNAL_KINDS = ["customer_email", "support_ticket", "churn_event", "competitor_move", "metric_anomaly", "calendar_conflict", "review", "feature_request", "cancellation_reason", "press_mention", "social_mention", "other"];

const METRIC_KINDS = ["revenue_pence", "spend_pence", "mrr_pence", "arr_pence", "paying_customers", "free_users", "mau", "wau", "dau", "conversion_rate", "churn_rate", "nps", "page_views", "signups", "cac_pence", "ltv_pence", "support_tickets_open", "runway_days", "other"];

const STATUSES: Venture["status"][] = ["researching", "validated", "building", "launched", "scaling", "paused"];
const CADENCES: Venture["cadence"][] = ["manual", "weekly", "daily", "twice_daily", "hourly"];
const CADENCE_LABEL: Record<string, string> = { daily: "DAILY", twice_daily: "TWICE DAILY", hourly: "HOURLY", weekly: "WEEKLY", manual: "MANUAL" };

const AUTONOMY_LEVELS: Autonomy[] = ["manual", "supervised", "autonomous", "full_autopilot"];
const AUTONOMY_LABEL: Record<Autonomy, string> = {
  manual: "MANUAL",
  supervised: "SUPERVISED",
  autonomous: "AUTONOMOUS",
  full_autopilot: "FULL AUTOPILOT",
};
const AUTONOMY_COLOR: Record<Autonomy, string> = {
  manual: TAUPE,
  supervised: BLUE,
  autonomous: MINT,
  full_autopilot: SALMON,
};
const AUTONOMY_DESC: Record<Autonomy, string> = {
  manual: "every decision queues. heartbeat fires only when you say.",
  supervised: "auto+notify execute. approve queues. heartbeat fires only when you say.",
  autonomous: "auto+notify execute. approve queues. heartbeat fires on cadence.",
  full_autopilot: "auto, notify AND approve all execute. heartbeat fires on cadence. high blast radius.",
};

const EXECUTION_STATUS_COLOR: Record<ExecutionStatus, string> = {
  pending: TAUPE,
  running: BLUE,
  succeeded: MINT,
  failed: SALMON,
  blocked: AMBER,
  cancelled: TAUPE,
};

function fmtMoney(p: number | null | undefined): string {
  if (p == null) return "£—";
  const v = p / 100;
  if (Math.abs(v) >= 1000) return `£${Math.round(v).toLocaleString()}`;
  return `£${v.toFixed(2)}`;
}
function fmtRel(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) {
    const a = Math.abs(diff);
    if (a < 3600_000) return `in ${Math.round(a/60_000)}m`;
    if (a < 86_400_000) return `in ${Math.round(a/3600_000)}h`;
    return `in ${Math.round(a/86_400_000)}d`;
  }
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.round(diff/60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff/3600_000)}h ago`;
  return `${Math.round(diff/86_400_000)}d ago`;
}

function isMetricMoney(kind: string): boolean {
  return kind.endsWith("_pence");
}

export function VentureDetail({ ventureId }: { ventureId: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"queue" | "history" | "signals" | "metrics" | "thesis" | "matrix" | "memory">("queue");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/ventures/${ventureId}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setData(j);
    }
    setLoading(false);
  }, [ventureId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const runHeartbeat = async () => {
    setRunning(true);
    try {
      const r = await fetch(`/api/ventures/${ventureId}/operator-loop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "heartbeat failed"); return; }
      const dispatched = (j.auto_dispatched ?? 0) + (j.notify_dispatched ?? 0) + (j.approve_dispatched ?? 0);
      const stop = j.panic_stop_active ? " · PANIC STOP active — nothing dispatched" : "";
      const summary = `${j.signals_consumed ?? 0} signals → ${j.decisions_proposed ?? 0} proposed (${dispatched} dispatched, ${j.queued ?? 0} queued)${stop}`;
      alert(summary);
      fetchAll();
    } finally {
      setRunning(false);
    }
  };

  if (loading || !data) {
    return <div style={{ padding: 24, color: TAUPE, fontStyle: "italic" }}>loading...</div>;
  }

  const { venture, decisions, signals, metrics } = data;
  const queued = decisions.filter((d) => d.status === "queued");
  const recent = decisions.filter((d) => d.status !== "queued");
  const color = STATUS_COLOR[venture.status] || TAUPE;
  const burnPct = venture.budget_pence > 0 ? Math.min(100, Math.round((venture.spent_pence / venture.budget_pence) * 100)) : 0;
  const autonomy: Autonomy = (venture.autonomy ?? "supervised") as Autonomy;
  const autoColor = AUTONOMY_COLOR[autonomy];
  const isPaused = Boolean(venture.paused_at);
  const isHalted = isPaused || venture.status === "killed" || venture.status === "paused";

  const togglePause = async () => {
    const path = isPaused ? "resume" : "pause";
    const r = await fetch(`/api/ventures/${ventureId}/${path}`, { method: "POST" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert((j as { error?: string }).error || `${path} failed`); return; }
    fetchAll();
  };

  const setAutonomy = async (next: Autonomy) => {
    if (next === "full_autopilot" && !confirm("FULL AUTOPILOT means JARVIS executes pivots, hires, contracts without checking in. The blast radius is large. Are you sure?")) return;
    const r = await fetch(`/api/ventures/${ventureId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autonomy: next }),
    });
    const j = await r.json();
    if (!r.ok) { alert((j as { error?: string }).error || "set autonomy failed"); return; }
    fetchAll();
  };

  return (
    <div style={{ padding: "16px 20px 80px", color: BONE, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${TAUPE}33` }}>
        <Link href="/ventures" style={{ color: TAUPE, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", textDecoration: "none" }}>← all ventures</Link>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 12, marginTop: 8 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, fontSize: 28 }}>{venture.name}</span>
              <span style={{ fontSize: 10, letterSpacing: "0.18em", color, textTransform: "uppercase", padding: "3px 10px", border: `1px solid ${color}55`, borderRadius: 2 }}>{STATUS_LABEL[venture.status]}</span>
              <span style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>{CADENCE_LABEL[venture.cadence] || venture.cadence}</span>
              <span style={{ fontSize: 10, letterSpacing: "0.18em", color: autoColor, textTransform: "uppercase", padding: "3px 10px", border: `1px solid ${autoColor}55`, borderRadius: 2 }}>{AUTONOMY_LABEL[autonomy]}</span>
              {isPaused && (
                <span style={{ fontSize: 10, letterSpacing: "0.18em", color: AMBER, textTransform: "uppercase", padding: "3px 10px", border: `1px solid ${AMBER}55`, borderRadius: 2 }}>HEARTBEAT PAUSED</span>
              )}
              {venture.thesis_revision > 0 && (
                <span style={{ fontSize: 10, letterSpacing: "0.18em", color: LAVENDER, textTransform: "uppercase" }}>· rev {venture.thesis_revision}</span>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: TAUPE, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              last heartbeat {fmtRel(venture.last_heartbeat_at)}
              {venture.cadence !== "manual" && venture.next_heartbeat_at && <> · next {fmtRel(venture.next_heartbeat_at)}</>}
              {venture.launched_at && <> · launched {fmtRel(venture.launched_at)}</>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <button
              onClick={runHeartbeat}
              disabled={running || isHalted}
              style={{
                background: running ? `${MINT}10` : MINT,
                color: running ? MINT : "#0a0a0a",
                border: `1px solid ${MINT}`,
                padding: "10px 18px",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: running || isHalted ? "not-allowed" : "pointer",
                borderRadius: 2,
                fontWeight: 600,
                opacity: isHalted ? 0.4 : 1,
              }}
            >
              {running ? "running operator loop..." : "▶ run heartbeat now"}
            </button>
            {venture.status !== "killed" && (
              <button
                onClick={togglePause}
                style={{
                  background: "transparent",
                  color: isPaused ? MINT : AMBER,
                  border: `1px solid ${(isPaused ? MINT : AMBER)}55`,
                  padding: "6px 14px",
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  borderRadius: 2,
                }}
              >
                {isPaused ? "▶ resume heartbeat" : "❚❚ pause heartbeat"}
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12, padding: 10, borderLeft: `3px solid ${autoColor}`, background: "#0c0c0c", borderRadius: 2 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase", marginBottom: 6 }}>autonomy</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {AUTONOMY_LEVELS.map((lvl) => {
              const c = AUTONOMY_COLOR[lvl];
              const active = lvl === autonomy;
              return (
                <button
                  key={lvl}
                  onClick={() => { if (!active) void setAutonomy(lvl); }}
                  style={{
                    background: active ? `${c}25` : "transparent",
                    color: active ? c : TAUPE,
                    border: `1px solid ${active ? c : TAUPE}55`,
                    padding: "5px 10px",
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    cursor: active ? "default" : "pointer",
                    borderRadius: 2,
                  }}
                >{AUTONOMY_LABEL[lvl]}</button>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: TAUPE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.45 }}>
            {AUTONOMY_DESC[autonomy]}
          </div>
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <Stat label="queued decisions" value={String(queued.length)} color={queued.length > 0 ? AMBER : SAGE} />
          <Stat label="signals waiting" value={String(signals.filter((s) => !s.processed_at).length)} color={BLUE} />
          <Stat label="capital deployed" value={fmtMoney(venture.spent_pence)} color={LAVENDER} />
          <Stat label="runway" value={fmtMoney(venture.budget_pence - venture.spent_pence)} color={burnPct >= 90 ? SALMON : burnPct >= 70 ? AMBER : SAGE} />
          <Stat label="burn" value={`${burnPct}%`} color={burnPct >= 90 ? SALMON : burnPct >= 70 ? AMBER : MINT} />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16, borderBottom: `1px solid ${TAUPE}22`, paddingBottom: 8 }}>
        <Tab id="queue" current={tab} setTab={setTab} color={AMBER} count={queued.length}>queue</Tab>
        <Tab id="history" current={tab} setTab={setTab} color={LAVENDER} count={recent.length}>decisions</Tab>
        <Tab id="signals" current={tab} setTab={setTab} color={BLUE} count={signals.length}>signals</Tab>
        <Tab id="metrics" current={tab} setTab={setTab} color={MINT} count={metrics.length}>metrics</Tab>
        <Tab id="thesis" current={tab} setTab={setTab} color={SAGE}>thesis</Tab>
        <Tab id="matrix" current={tab} setTab={setTab} color={LAVENDER}>decision rights</Tab>
        <Tab id="memory" current={tab} setTab={setTab} color={PEACH}>operator memory</Tab>
      </div>

      {tab === "queue" && <DecisionList decisions={queued} ventureId={ventureId} mode="queue" onChange={fetchAll} />}
      {tab === "history" && <DecisionList decisions={recent} ventureId={ventureId} mode="history" onChange={fetchAll} />}
      {tab === "signals" && <SignalsPanel signals={signals} ventureId={ventureId} onChange={fetchAll} />}
      {tab === "metrics" && <MetricsPanel metrics={metrics} ventureId={ventureId} onChange={fetchAll} />}
      {tab === "thesis" && <ThesisEditor venture={venture} onSaved={fetchAll} />}
      {tab === "matrix" && <MatrixEditor venture={venture} onSaved={fetchAll} />}
      {tab === "memory" && <MemoryEditor venture={venture} onSaved={fetchAll} />}
    </div>
  );
}

function Tab({ id, current, setTab, color, children, count }: { id: string; current: string; setTab: (t: never) => void; color: string; children: React.ReactNode; count?: number }) {
  const active = current === id;
  return (
    <button
      onClick={() => setTab(id as never)}
      style={{
        background: active ? `${color}20` : "transparent",
        color: active ? color : TAUPE,
        border: `1px solid ${active ? color : TAUPE}33`,
        padding: "6px 12px",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        cursor: "pointer",
        borderRadius: 2,
      }}
    >
      {children}
      {count !== undefined && count > 0 && <span style={{ marginLeft: 6, color: active ? color : TAUPE, fontSize: 9 }}>{count}</span>}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, background: "#0c0c0c", padding: "8px 12px", borderRadius: 2 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 18, color, marginTop: 2, fontFamily: "Georgia, serif", fontStyle: "italic" }}>{value}</div>
    </div>
  );
}

function DecisionList({ decisions, ventureId, mode, onChange }: { decisions: Decision[]; ventureId: string; mode: "queue" | "history"; onChange: () => void }) {
  const [overrideTarget, setOverrideTarget] = useState<Decision | null>(null);
  const [overrideNote, setOverrideNote] = useState("");

  const patch = async (decId: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/ventures/${ventureId}/decisions/${decId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) { alert(j.error || "failed"); return false; }
    return true;
  };

  if (decisions.length === 0) {
    return (
      <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>
        {mode === "queue" ? "nothing in the queue. when jarvis fires the operator loop, decisions classified as APPROVE will land here." : "no decision history yet. run the operator loop to populate."}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {decisions.map((d) => {
          const tColor = TIER_COLOR[d.tier];
          const sColor = DECISION_STATUS_COLOR[d.status];
          return (
            <div key={d.id} style={{ borderLeft: `3px solid ${sColor}`, background: "#0c0c0c", padding: "12px 14px", borderRadius: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, letterSpacing: "0.18em", color: tColor, textTransform: "uppercase", padding: "2px 6px", border: `1px solid ${tColor}55`, borderRadius: 2 }}>{d.tier}</span>
                    <span style={{ fontSize: 9, letterSpacing: "0.18em", color: sColor, textTransform: "uppercase", padding: "2px 6px", border: `1px solid ${sColor}55`, borderRadius: 2 }}>{d.status.replace(/_/g, " ")}</span>
                    {d.execution_status && (
                      <span style={{ fontSize: 9, letterSpacing: "0.18em", color: EXECUTION_STATUS_COLOR[d.execution_status], textTransform: "uppercase", padding: "2px 6px", border: `1px solid ${EXECUTION_STATUS_COLOR[d.execution_status]}55`, borderRadius: 2 }}>EXEC: {d.execution_status}</span>
                    )}
                    <span style={{ fontSize: 9, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>{d.kind}</span>
                    {d.estimated_spend_pence > 0 && <span style={{ fontSize: 10, color: LAVENDER }}>{fmtMoney(d.estimated_spend_pence)}</span>}
                    {d.execution_task_id && (
                      <Link href={`/tasks/${d.execution_task_id}`} style={{ fontSize: 9, letterSpacing: "0.18em", color: BLUE, textTransform: "uppercase", textDecoration: "none" }}>→ task</Link>
                    )}
                    <ChargeDots n={d.confidence} color={MINT} />
                  </div>
                  <div style={{ marginTop: 6, fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, fontSize: 14 }}>{d.title}</div>
                  <div style={{ marginTop: 4, color: BONE, fontSize: 12, lineHeight: 1.55, opacity: 0.85 }}>{d.body}</div>
                  {d.reasoning && (
                    <div style={{ marginTop: 6, fontSize: 11, color: TAUPE, fontStyle: "italic", borderLeft: `1px solid ${TAUPE}33`, paddingLeft: 8 }}>
                      <span style={{ letterSpacing: "0.18em", textTransform: "uppercase", marginRight: 6 }}>why:</span>{d.reasoning}
                    </div>
                  )}
                  {d.user_response_note && (
                    <div style={{ marginTop: 6, fontSize: 11, color: PEACH, fontStyle: "italic", borderLeft: `1px solid ${PEACH}55`, paddingLeft: 8 }}>
                      <span style={{ letterSpacing: "0.18em", textTransform: "uppercase", marginRight: 6 }}>your note:</span>{d.user_response_note}
                    </div>
                  )}
                  {d.outcome_note && (
                    <div style={{ marginTop: 6, fontSize: 11, color: SAGE, fontStyle: "italic" }}>
                      <span style={{ letterSpacing: "0.18em", textTransform: "uppercase", marginRight: 6 }}>outcome:</span>{d.outcome_note}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 100, textAlign: "right", fontSize: 10, color: TAUPE }}>
                  <div>{fmtRel(d.created_at)}</div>
                  {d.executed_at && <div style={{ marginTop: 4, color: SAGE }}>fired {fmtRel(d.executed_at)}</div>}
                </div>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {d.status === "queued" && (
                  <>
                    <ActionBtn color={MINT} onClick={async () => { if (await patch(d.id, { mode: "approve" })) onChange(); }}>approve</ActionBtn>
                    <ActionBtn color={SALMON} onClick={async () => { if (await patch(d.id, { mode: "reject" })) onChange(); }}>reject</ActionBtn>
                    <ActionBtn color={TAUPE} onClick={async () => { if (await patch(d.id, { mode: "cancel" })) onChange(); }}>cancel</ActionBtn>
                  </>
                )}
                {d.status === "approved" && (
                  <ActionBtn color={MINT} onClick={async () => { if (await patch(d.id, { mode: "execute" })) onChange(); }}>mark executed</ActionBtn>
                )}
                {(d.status === "auto_executed" || d.status === "notified" || d.status === "executed") && (
                  <>
                    <ActionBtn color={PEACH} onClick={() => { setOverrideTarget(d); setOverrideNote(""); }}>override</ActionBtn>
                    <ActionBtn color={SALMON} onClick={async () => { if (await patch(d.id, { mode: "fail" })) onChange(); }}>mark failed</ActionBtn>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {overrideTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setOverrideTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600, width: "100%", background: "#0a0a0a", border: `2px solid ${PEACH}`, padding: 22, borderRadius: 4 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: PEACH, marginBottom: 6 }}>override decision</div>
            <div style={{ fontSize: 13, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 12 }}>
              jarvis {overrideTarget.status === "auto_executed" ? "auto-fired" : "fired"}: <span style={{ color: PEACH }}>{overrideTarget.title}</span>. tell jarvis what should have happened instead — this lands in the next heartbeat as feedback so the loop learns your preferences.
            </div>
            <textarea
              autoFocus
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              placeholder="what should have happened instead"
              style={{ width: "100%", minHeight: 80, background: "#000", color: BONE, border: `1px solid ${TAUPE}55`, padding: 10, fontFamily: "Georgia, serif", fontSize: 13, fontStyle: "italic", borderRadius: 2, resize: "vertical" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setOverrideTarget(null)} style={{ background: "transparent", color: TAUPE, border: `1px solid ${TAUPE}55`, padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>cancel</button>
              <button
                onClick={async () => {
                  if (overrideNote.trim().length < 4) { alert("override note needs ≥4 chars"); return; }
                  if (await patch(overrideTarget.id, { mode: "override", override_note: overrideNote.trim() })) {
                    setOverrideTarget(null);
                    onChange();
                  }
                }}
                style={{ background: PEACH, color: "#0a0a0a", border: "none", padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600 }}
              >confirm override</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionBtn({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ background: `${color}15`, color, border: `1px solid ${color}55`, padding: "5px 10px", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>
      {children}
    </button>
  );
}

function ChargeDots({ n, color }: { n: number; color: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 2, marginLeft: 4 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i <= n ? color : `${color}33` }} />
      ))}
    </span>
  );
}

function SignalsPanel({ signals, ventureId, onChange }: { signals: Signal[]; ventureId: string; onChange: () => void }) {
  const [showLog, setShowLog] = useState(false);
  const [kind, setKind] = useState("customer_email");
  const [body, setBody] = useState("");
  const [weight, setWeight] = useState(3);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (body.trim().length < 2) { alert("body required"); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/ventures/${ventureId}/signals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, body: body.trim(), weight }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "failed"); return; }
      setBody(""); setShowLog(false); onChange();
    } finally { setSubmitting(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>signals — anything the operator loop should weigh next heartbeat</div>
        <button onClick={() => setShowLog((v) => !v)} style={{ background: showLog ? "transparent" : `${BLUE}20`, color: BLUE, border: `1px solid ${BLUE}55`, padding: "4px 10px", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>
          {showLog ? "cancel" : "+ log signal"}
        </button>
      </div>

      {showLog && (
        <div style={{ marginBottom: 14, border: `1px solid ${BLUE}55`, background: `${BLUE}08`, padding: 12, borderRadius: 2 }}>
          <Field label="kind">
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
              {SIGNAL_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
          <Field label="body">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, minHeight: 70, fontFamily: "Georgia, serif", fontStyle: "italic" }} placeholder="customer X said the onboarding was confusing on step 3..." />
          </Field>
          <Field label={`weight · ${weight}`}>
            <input type="range" min={1} max={5} value={weight} onChange={(e) => setWeight(Number(e.target.value))} style={{ width: "100%" }} />
          </Field>
          <button onClick={submit} disabled={submitting} style={{ background: BLUE, color: "#0a0a0a", border: "none", padding: "7px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>{submitting ? "logging..." : "log"}</button>
        </div>
      )}

      {signals.length === 0 ? (
        <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>no signals captured yet. log customer emails, churn events, support tickets, competitor moves — anything the operator loop should weigh.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {signals.map((s) => {
            const c = SIGNAL_KIND_COLOR[s.kind] || TAUPE;
            return (
              <div key={s.id} style={{ borderLeft: `3px solid ${c}`, background: "#0c0c0c", padding: "10px 12px", borderRadius: 2, opacity: s.processed_at ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, letterSpacing: "0.18em", color: c, textTransform: "uppercase" }}>{s.kind.replace(/_/g, " ")}</span>
                  <ChargeDots n={s.weight} color={c} />
                  {s.processed_at && <span style={{ fontSize: 9, letterSpacing: "0.18em", color: SAGE, textTransform: "uppercase" }}>processed</span>}
                  <span style={{ marginLeft: "auto", fontSize: 10, color: TAUPE }}>{fmtRel(s.captured_at)}</span>
                </div>
                <div style={{ marginTop: 4, color: BONE, fontSize: 13, fontFamily: "Georgia, serif", fontStyle: "italic", lineHeight: 1.5 }}>{s.body}</div>
                {s.source && <div style={{ marginTop: 4, fontSize: 10, color: TAUPE }}>source: {s.source}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricsPanel({ metrics, ventureId, onChange }: { metrics: MetricRow[]; ventureId: string; onChange: () => void }) {
  const [showLog, setShowLog] = useState(false);
  const [kind, setKind] = useState("revenue_pence");
  const [value, setValue] = useState<number>(0);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const grouped = useMemo(() => {
    const map: Record<string, MetricRow[]> = {};
    for (const m of metrics) {
      const arr = map[m.metric_kind] ?? (map[m.metric_kind] = []);
      arr.push(m);
    }
    return map;
  }, [metrics]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const sendValue = isMetricMoney(kind) ? Math.round(value * 100) : value;
      const r = await fetch(`/api/ventures/${ventureId}/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric_kind: kind, value: sendValue, note: note.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "failed"); return; }
      setValue(0); setNote(""); setShowLog(false); onChange();
    } finally { setSubmitting(false); }
  };

  const fmtMetricValue = (m: MetricRow): string => {
    if (isMetricMoney(m.metric_kind)) return fmtMoney(m.value);
    if (m.metric_kind === "conversion_rate" || m.metric_kind === "churn_rate") return `${(m.value * 100).toFixed(2)}%`;
    return String(m.value);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>metrics — log measurements jarvis can reason against</div>
        <button onClick={() => setShowLog((v) => !v)} style={{ background: showLog ? "transparent" : `${MINT}20`, color: MINT, border: `1px solid ${MINT}55`, padding: "4px 10px", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>
          {showLog ? "cancel" : "+ log metric"}
        </button>
      </div>

      {showLog && (
        <div style={{ marginBottom: 14, border: `1px solid ${MINT}55`, background: `${MINT}08`, padding: 12, borderRadius: 2 }}>
          <Field label="metric">
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
              {METRIC_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
          <Field label={isMetricMoney(kind) ? "value · £" : "value"}>
            <input type="number" step="any" value={value} onChange={(e) => setValue(Number(e.target.value))} style={inputStyle} />
          </Field>
          <Field label="note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} placeholder="from stripe dashboard" />
          </Field>
          <button onClick={submit} disabled={submitting} style={{ background: MINT, color: "#0a0a0a", border: "none", padding: "7px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>{submitting ? "logging..." : "log"}</button>
        </div>
      )}

      {Object.keys(grouped).length === 0 ? (
        <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>no metrics logged yet. log revenue, MRR, signups, churn, NPS — whatever defines this venture.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {Object.entries(grouped).map(([kindName, rows]) => {
            const sorted = [...rows].sort((a, b) => a.captured_for_date.localeCompare(b.captured_for_date));
            const latest = sorted[sorted.length - 1];
            if (!latest) return null;
            return (
              <div key={kindName} style={{ borderLeft: `3px solid ${MINT}`, background: "#0c0c0c", padding: "10px 14px", borderRadius: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>{kindName.replace(/_/g, " ")}</span>
                  <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 22, color: MINT }}>{fmtMetricValue(latest)}</span>
                </div>
                <Sparkline rows={sorted} kind={kindName} />
                <div style={{ fontSize: 10, color: TAUPE, marginTop: 4 }}>{rows.length} data point{rows.length === 1 ? "" : "s"} · latest {latest.captured_for_date}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Sparkline({ rows, kind }: { rows: MetricRow[]; kind: string }) {
  if (rows.length < 2) return null;
  const values = rows.map((r) => r.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 600;
  const h = 40;
  const pts = rows.map((r, i) => {
    const x = (i / (rows.length - 1)) * w;
    const y = h - ((r.value - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  const isGoodUp = !["churn_rate", "spend_pence", "cac_pence", "support_tickets_open"].includes(kind);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const trend = last - first;
  const trendColor = (trend >= 0) === isGoodUp ? MINT : SALMON;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 40, marginTop: 6 }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={trendColor} strokeWidth={1.5} />
    </svg>
  );
}

function ThesisEditor({ venture, onSaved }: { venture: Venture; onSaved: () => void }) {
  const [name, setName] = useState(venture.name);
  const [thesis, setThesis] = useState(venture.thesis);
  const [status, setStatus] = useState(venture.status);
  const [budget, setBudget] = useState(venture.budget_pence / 100);
  const [spent, setSpent] = useState(venture.spent_pence / 100);
  const [killCriteria, setKillCriteria] = useState(venture.kill_criteria ?? "");
  const [cadence, setCadence] = useState(venture.cadence);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/ventures/${venture.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          thesis,
          status,
          budget_pence: Math.round(budget * 100),
          spent_pence: Math.round(spent * 100),
          kill_criteria: killCriteria,
          cadence,
        }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "save failed"); return; }
      onSaved();
    } finally { setSaving(false); }
  };

  const killVenture = async () => {
    const reason = prompt("kill reason (≥4 chars):");
    if (!reason || reason.length < 4) return;
    const r = await fetch(`/api/ventures/${venture.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const j = await r.json();
    if (!r.ok) { alert(j.error || "kill failed"); return; }
    onSaved();
  };

  return (
    <div>
      <Field label="name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </Field>
      <Field label={`thesis · revising bumps revision counter (currently rev ${venture.thesis_revision})`}>
        <textarea value={thesis} onChange={(e) => setThesis(e.target.value)} style={{ ...inputStyle, minHeight: 120, fontFamily: "Georgia, serif", fontStyle: "italic" }} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <Field label="status">
          <select value={status} onChange={(e) => setStatus(e.target.value as Venture["status"])} style={inputStyle}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
          </select>
        </Field>
        <Field label="cadence">
          <select value={cadence} onChange={(e) => setCadence(e.target.value as Venture["cadence"])} style={inputStyle}>
            {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
          </select>
        </Field>
        <div />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="budget · £">
          <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} style={inputStyle} />
        </Field>
        <Field label="spent · £ · adjust if you've spent outside jarvis">
          <input type="number" value={spent} onChange={(e) => setSpent(Number(e.target.value) || 0)} style={inputStyle} />
        </Field>
      </div>
      <Field label="kill criteria">
        <textarea value={killCriteria} onChange={(e) => setKillCriteria(e.target.value)} style={{ ...inputStyle, minHeight: 80 }} />
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "space-between" }}>
        <button onClick={killVenture} style={{ background: "transparent", color: SALMON, border: `1px solid ${SALMON}55`, padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>kill venture</button>
        <button onClick={save} disabled={saving} style={{ background: MINT, color: "#0a0a0a", border: "none", padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "saving..." : "save"}</button>
      </div>
      {venture.killed_at && (
        <div style={{ marginTop: 16, padding: 12, border: `1px solid ${SALMON}55`, borderRadius: 2, background: `${SALMON}08` }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: SALMON, textTransform: "uppercase" }}>killed {fmtRel(venture.killed_at)}</div>
          {venture.killed_reason && <div style={{ marginTop: 4, color: BONE, fontSize: 13, fontFamily: "Georgia, serif", fontStyle: "italic" }}>{venture.killed_reason}</div>}
        </div>
      )}
    </div>
  );
}

function MatrixEditor({ venture, onSaved }: { venture: Venture; onSaved: () => void }) {
  const [matrix, setMatrix] = useState<DecisionMatrix>(() => venture.decision_matrix ?? { auto: { max_spend_pence: 5000, kinds: [] }, notify: { max_spend_pence: 50000, kinds: [] }, approve: { kinds: [] } });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/ventures/${venture.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision_matrix: matrix }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "save failed"); return; }
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 14, fontSize: 12, color: TAUPE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>
        when jarvis proposes a decision, it's classified by spend + kind. AUTO fires silently, NOTIFY fires and pings whatsapp, APPROVE waits in your queue. anything in APPROVE_KINDS always queues regardless of spend. spend over NOTIFY cap also forces APPROVE.
      </div>

      <Tier3 label="auto · silent fire" color={SAGE} matrix={matrix} setMatrix={setMatrix} which="auto" />
      <Tier3 label="notify · fire + whatsapp ping" color={BLUE} matrix={matrix} setMatrix={setMatrix} which="notify" />
      <Tier3 label="approve · queue for your call" color={AMBER} matrix={matrix} setMatrix={setMatrix} which="approve" />

      <div style={{ marginTop: 14 }}>
        <button onClick={save} disabled={saving} style={{ background: MINT, color: "#0a0a0a", border: "none", padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "saving..." : "save matrix"}</button>
      </div>
    </div>
  );
}

function updateTierKinds(matrix: DecisionMatrix, which: "auto" | "notify" | "approve", kinds: string[]): DecisionMatrix {
  if (which === "approve") return { ...matrix, approve: { kinds } };
  if (which === "auto") return { ...matrix, auto: { ...matrix.auto, kinds } };
  return { ...matrix, notify: { ...matrix.notify, kinds } };
}

function Tier3({ label, color, matrix, setMatrix, which }: { label: string; color: string; matrix: DecisionMatrix; setMatrix: (m: DecisionMatrix) => void; which: "auto" | "notify" | "approve" }) {
  const block = matrix[which];
  const hasCap = which !== "approve";
  const cap = hasCap ? (block as { max_spend_pence: number; kinds: string[] }).max_spend_pence : 0;
  const kinds = block.kinds ?? [];
  const [newKind, setNewKind] = useState("");

  return (
    <div style={{ marginBottom: 14, borderLeft: `3px solid ${color}`, background: "#0c0c0c", padding: "12px 14px", borderRadius: 2 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.18em", color, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      {hasCap && (
        <Field label="max spend per decision · £">
          <input type="number" value={cap / 100} onChange={(e) => {
            const next = { ...matrix };
            (next[which] as { max_spend_pence: number; kinds: string[] }).max_spend_pence = Math.round(Number(e.target.value) * 100);
            setMatrix(next);
          }} style={inputStyle} />
        </Field>
      )}
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase", marginBottom: 4 }}>kinds</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {kinds.length === 0 && <span style={{ fontSize: 11, color: TAUPE, fontStyle: "italic" }}>(none)</span>}
        {kinds.map((k, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, letterSpacing: "0.1em", color, textTransform: "uppercase", padding: "3px 8px", border: `1px solid ${color}55`, borderRadius: 2 }}>
            {k}
            <button
              onClick={() => {
                const filtered = kinds.filter((_, idx) => idx !== i);
                setMatrix(updateTierKinds(matrix, which, filtered));
              }}
              style={{ background: "transparent", color, border: "none", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}
            >×</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={newKind} onChange={(e) => setNewKind(e.target.value)} placeholder="e.g. pricing_change" style={{ ...inputStyle, flex: 1 }} />
        <button
          onClick={() => {
            const k = newKind.trim().toLowerCase();
            if (!k) return;
            setMatrix(updateTierKinds(matrix, which, [...kinds, k]));
            setNewKind("");
          }}
          style={{ background: `${color}20`, color, border: `1px solid ${color}55`, padding: "6px 12px", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}
        >add</button>
      </div>
    </div>
  );
}

function MemoryEditor({ venture, onSaved }: { venture: Venture; onSaved: () => void }) {
  const [memory, setMemory] = useState(venture.operator_memory ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/ventures/${venture.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator_memory: memory }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "save failed"); return; }
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 10, fontSize: 12, color: TAUPE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>
        the operator&rsquo;s living strategy doc. heartbeats append summaries here so jarvis carries continuity across runs. you can edit it directly — write the strategy notes you want jarvis to read at every heartbeat.
      </div>
      <textarea
        value={memory}
        onChange={(e) => setMemory(e.target.value)}
        style={{ width: "100%", minHeight: 360, background: "#000", color: BONE, border: `1px solid ${TAUPE}55`, padding: 12, fontSize: 13, fontFamily: "ui-monospace, Menlo, monospace", borderRadius: 2, resize: "vertical", lineHeight: 1.55 }}
        placeholder="## strategy&#10;- target: solo founders earning £50k+ from a side product&#10;- wedge: WhatsApp-native onboarding&#10;- moat: persistent operator memory the user can edit&#10;&#10;## kill criteria&#10;- if MRR < £200 by day 90&#10;- if churn > 8% monthly&#10;&#10;## operator notes&#10;- prioritise paid acquisition over content for first 30 days"
      />
      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: TAUPE, letterSpacing: "0.1em", textTransform: "uppercase" }}>{memory.length} chars · capped at 50k</span>
        <button onClick={save} disabled={saving} style={{ background: PEACH, color: "#0a0a0a", border: "none", padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? "saving..." : "save memory"}</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#000",
  color: BONE,
  border: `1px solid ${TAUPE}55`,
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 2,
  fontFamily: "ui-sans-serif, system-ui",
};
