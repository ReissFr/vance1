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
  cadence: "daily" | "twice_daily" | "hourly" | "weekly" | "manual";
  next_heartbeat_at: string | null;
  last_heartbeat_at: string | null;
  launched_at: string | null;
  killed_at: string | null;
  thesis_revision: number;
  runway_pence: number;
  queued_decisions: number;
  recent_decisions_7d: number;
  unprocessed_signals: number;
  latest_revenue_pence: number | null;
  created_at: string;
  updated_at: string;
};

const AUTONOMY_LABEL: Record<Autonomy, string> = {
  manual: "MANUAL",
  supervised: "SUPERVISED",
  autonomous: "AUTONOMOUS",
  full_autopilot: "AUTOPILOT",
};
const AUTONOMY_COLOR: Record<Autonomy, string> = {
  manual: TAUPE,
  supervised: BLUE,
  autonomous: MINT,
  full_autopilot: SALMON,
};

type Stats = {
  total: number;
  by_status: Record<string, number>;
  total_budget_pence: number;
  total_spent_pence: number;
  total_queued_decisions: number;
};

const STATUS_COLOR: Record<string, string> = {
  researching: BLUE,
  validated: LAVENDER,
  building: AMBER,
  launched: MINT,
  scaling: MINT,
  paused: TAUPE,
  killed: SALMON,
};

const STATUS_LABEL: Record<string, string> = {
  researching: "RESEARCHING",
  validated: "VALIDATED",
  building: "BUILDING",
  launched: "LAUNCHED",
  scaling: "SCALING",
  paused: "PAUSED",
  killed: "KILLED",
};

const CADENCE_LABEL: Record<string, string> = {
  daily: "DAILY",
  twice_daily: "TWICE DAILY",
  hourly: "HOURLY",
  weekly: "WEEKLY",
  manual: "MANUAL",
};

const STATUSES = ["researching", "validated", "building", "launched", "scaling", "paused"];
const CADENCES = ["manual", "weekly", "daily", "twice_daily", "hourly"];

function fmtMoney(pence: number | null | undefined): string {
  if (pence == null) return "£—";
  const pounds = pence / 100;
  if (Math.abs(pounds) >= 1000) return `£${Math.round(pounds).toLocaleString()}`;
  return `£${pounds.toFixed(2)}`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) {
    const ahead = Math.abs(diff);
    if (ahead < 3600_000) return `in ${Math.round(ahead / 60_000)}m`;
    if (ahead < 86_400_000) return `in ${Math.round(ahead / 3600_000)}h`;
    return `in ${Math.round(ahead / 86_400_000)}d`;
  }
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

type PanicState = { panic_stop_at: string | null; reason: string | null };

export function VenturesBoard() {
  const [rows, setRows] = useState<Venture[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showKilled, setShowKilled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [panic, setPanic] = useState<PanicState>({ panic_stop_at: null, reason: null });
  const [panicBusy, setPanicBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newThesis, setNewThesis] = useState("");
  const [newBudgetGBP, setNewBudgetGBP] = useState<number>(500);
  const [newCadence, setNewCadence] = useState<string>("daily");
  const [newKillCriteria, setNewKillCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all" && statusFilter !== "active") params.set("status", statusFilter);
    if (showKilled) params.set("include_killed", "true");
    const r = await fetch(`/api/ventures?${params.toString()}`, { cache: "no-store" });
    const j = await r.json();
    let v = (j.ventures ?? []) as Venture[];
    if (statusFilter === "active") v = v.filter((x) => x.status !== "killed" && x.status !== "paused");
    setRows(v);
    setStats(j.stats ?? null);
    setLoading(false);
  }, [statusFilter, showKilled]);

  const fetchPanic = useCallback(async () => {
    try {
      const r = await fetch("/api/ventures/panic-status", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { panic_stop_at?: string | null; reason?: string | null };
      setPanic({ panic_stop_at: j.panic_stop_at ?? null, reason: j.reason ?? null });
    } catch {
      // soft-fail — banner is informational
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { fetchPanic(); }, [fetchPanic]);

  const togglePanic = async () => {
    if (panicBusy) return;
    const isStopped = Boolean(panic.panic_stop_at);
    if (!isStopped && !confirm("PANIC STOP halts ALL venture autonomy across every venture. Cron skips them; manual heartbeats refuse to dispatch. Continue?")) return;
    setPanicBusy(true);
    try {
      if (isStopped) {
        await fetch("/api/ventures/panic-clear", { method: "POST" });
      } else {
        const reason = prompt("(optional) reason for panic stop:") ?? "";
        await fetch("/api/ventures/panic-stop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        });
      }
      await fetchPanic();
    } finally {
      setPanicBusy(false);
    }
  };

  const submitNew = async () => {
    if (newName.trim().length < 2 || newThesis.trim().length < 20) {
      alert("name (≥2 chars) and thesis (≥20 chars) are required");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/ventures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          thesis: newThesis.trim(),
          budget_pence: Math.round(newBudgetGBP * 100),
          cadence: newCadence,
          kill_criteria: newKillCriteria.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "create failed"); return; }
      setNewName("");
      setNewThesis("");
      setNewBudgetGBP(500);
      setNewKillCriteria("");
      setNewCadence("daily");
      setCreating(false);
      fetchRows();
    } finally {
      setSubmitting(false);
    }
  };

  const summary = useMemo(() => {
    if (!stats) return null;
    const active = (stats.by_status.researching ?? 0)
      + (stats.by_status.validated ?? 0)
      + (stats.by_status.building ?? 0)
      + (stats.by_status.launched ?? 0)
      + (stats.by_status.scaling ?? 0);
    return { active, queued: stats.total_queued_decisions, budget: stats.total_budget_pence, spent: stats.total_spent_pence };
  }, [stats]);

  return (
    <div style={{ padding: "16px 20px 80px", color: BONE, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${TAUPE}33` }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>businesses jarvis is running for you</div>
          <div style={{ fontSize: 13, color: BONE, marginTop: 4, fontStyle: "italic", fontFamily: "Georgia, serif" }}>
            you chair the board, jarvis runs the floor.
          </div>
        </div>
        <button
          onClick={togglePanic}
          disabled={panicBusy}
          style={{
            background: panic.panic_stop_at ? SALMON : "transparent",
            color: panic.panic_stop_at ? "#0a0a0a" : SALMON,
            border: `1px solid ${SALMON}`,
            padding: "8px 14px",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: panicBusy ? "wait" : "pointer",
            borderRadius: 2,
            fontWeight: 600,
            opacity: panicBusy ? 0.6 : 1,
          }}
        >
          {panic.panic_stop_at ? "▶ resume autonomy" : "■ panic stop"}
        </button>
        <button
          onClick={() => setCreating((v) => !v)}
          style={{
            background: creating ? "transparent" : MINT,
            color: creating ? MINT : "#0a0a0a",
            border: `1px solid ${MINT}`,
            padding: "8px 14px",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
            borderRadius: 2,
            fontWeight: 600,
          }}
        >
          {creating ? "cancel" : "+ new venture"}
        </button>
      </div>

      {panic.panic_stop_at && (
        <div style={{ marginBottom: 16, padding: 12, border: `2px solid ${SALMON}`, background: `${SALMON}15`, borderRadius: 4 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: SALMON, textTransform: "uppercase", fontWeight: 600 }}>
            ■ PANIC STOP ACTIVE — all venture autonomy halted
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
            triggered {fmtRelative(panic.panic_stop_at)}{panic.reason ? ` · reason: ${panic.reason}` : ""}. cron skips every venture; manual heartbeats refuse to dispatch. press <span style={{ color: SALMON }}>RESUME AUTONOMY</span> to clear.
          </div>
        </div>
      )}

      {creating && (
        <div style={{ marginBottom: 18, border: `1px solid ${MINT}55`, padding: 16, borderRadius: 4, background: `${MINT}08` }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: MINT, textTransform: "uppercase", marginBottom: 10 }}>charter a new venture</div>
          <Field label="name">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. peptide stack co"
              style={inputStyle}
            />
          </Field>
          <Field label="thesis · what this is, who it's for, why now (≥20 chars)">
            <textarea
              value={newThesis}
              onChange={(e) => setNewThesis(e.target.value)}
              placeholder="we sell research-grade peptide stacks to biohacker founders who want a one-stop shop with verified COAs. the wedge is bundle-by-goal (sleep / focus / recovery) priced as a kit."
              style={{ ...inputStyle, minHeight: 90, resize: "vertical", fontFamily: "Georgia, serif", fontStyle: "italic" }}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="budget · £">
              <input
                type="number"
                value={newBudgetGBP}
                onChange={(e) => setNewBudgetGBP(Number(e.target.value) || 0)}
                style={inputStyle}
              />
            </Field>
            <Field label="cadence · how often jarvis runs the operator loop">
              <select value={newCadence} onChange={(e) => setNewCadence(e.target.value)} style={inputStyle}>
                {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="kill criteria · what would make us shut this down (optional, edit later)">
            <textarea
              value={newKillCriteria}
              onChange={(e) => setNewKillCriteria(e.target.value)}
              placeholder="kill if MRR < £200 by day 90, or burn rate makes runway < 60 days"
              style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
            />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button onClick={submitNew} disabled={submitting} style={{ ...primaryBtn(MINT), opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "creating..." : "charter venture"}
            </button>
          </div>
        </div>
      )}

      {summary && summary.active + (stats?.by_status.killed ?? 0) + (stats?.by_status.paused ?? 0) > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="active ventures" value={summary.active} sub={`${stats?.by_status.killed ?? 0} killed · ${stats?.by_status.paused ?? 0} paused`} color={MINT} />
          <StatCard label="queued decisions" value={summary.queued} sub={summary.queued > 0 ? "awaiting your call" : "nothing pending"} color={summary.queued > 0 ? AMBER : SAGE} />
          <StatCard label="capital deployed" value={fmtMoney(summary.spent)} sub={`of ${fmtMoney(summary.budget)} chartered`} color={LAVENDER} />
          <StatCard label="runway" value={fmtMoney(summary.budget - summary.spent)} sub="across all ventures" color={BLUE} />
        </div>
      )}

      <FilterRow label="status">
        <Pill active={statusFilter === "active"} onClick={() => setStatusFilter("active")} color={MINT}>active</Pill>
        {STATUSES.map((s) => (
          <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} color={STATUS_COLOR[s] || TAUPE}>{(STATUS_LABEL[s] || s).toLowerCase()}</Pill>
        ))}
        <Pill active={statusFilter === "all"} onClick={() => setStatusFilter("all")} color={BONE}>all</Pill>
        <button
          onClick={() => setShowKilled((v) => !v)}
          style={{
            background: showKilled ? `${SALMON}20` : "transparent",
            color: showKilled ? SALMON : TAUPE,
            border: `1px solid ${showKilled ? SALMON : TAUPE}55`,
            padding: "4px 8px",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
            borderRadius: 2,
            marginLeft: 12,
          }}
        >
          {showKilled ? "hiding none" : "include killed"}
        </button>
      </FilterRow>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>
            no ventures yet. press <span style={{ color: MINT }}>+ NEW VENTURE</span> to charter one — give jarvis a thesis, a budget, and a cadence, and it will run the operator loop on your behalf.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((v) => <VentureCard key={v.id} v={v} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function VentureCard({ v }: { v: Venture }) {
  const color = STATUS_COLOR[v.status] || TAUPE;
  const burnPct = v.budget_pence > 0 ? Math.min(100, Math.round((v.spent_pence / v.budget_pence) * 100)) : 0;
  const autonomy: Autonomy = (v.autonomy ?? "supervised") as Autonomy;
  const autoColor = AUTONOMY_COLOR[autonomy];
  const isPaused = Boolean(v.paused_at);
  return (
    <Link href={`/ventures/${v.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{ borderLeft: `3px solid ${color}`, background: "#0c0c0c", padding: "14px 16px", borderRadius: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "Georgia, serif", fontSize: 18, color: BONE, fontStyle: "italic" }}>{v.name}</span>
              <span style={{ fontSize: 9, letterSpacing: "0.18em", color, textTransform: "uppercase", padding: "2px 8px", border: `1px solid ${color}55`, borderRadius: 2 }}>{STATUS_LABEL[v.status] || v.status}</span>
              <span style={{ fontSize: 9, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>{CADENCE_LABEL[v.cadence] || v.cadence}</span>
              <span style={{ fontSize: 9, letterSpacing: "0.18em", color: autoColor, textTransform: "uppercase", padding: "2px 8px", border: `1px solid ${autoColor}55`, borderRadius: 2 }}>{AUTONOMY_LABEL[autonomy]}</span>
              {isPaused && (
                <span style={{ fontSize: 9, letterSpacing: "0.18em", color: AMBER, textTransform: "uppercase", padding: "2px 8px", border: `1px solid ${AMBER}55`, borderRadius: 2 }}>PAUSED</span>
              )}
              {v.thesis_revision > 0 && (
                <span style={{ fontSize: 9, letterSpacing: "0.18em", color: LAVENDER, textTransform: "uppercase" }}>· rev {v.thesis_revision}</span>
              )}
            </div>
            <div style={{ marginTop: 6, fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, fontSize: 13, lineHeight: 1.5, opacity: 0.85 }}>
              {v.thesis.length > 220 ? `${v.thesis.slice(0, 220)}...` : v.thesis}
            </div>
          </div>
          <div style={{ minWidth: 120, textAlign: "right" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>last heartbeat</div>
            <div style={{ fontSize: 12, color: BONE, marginTop: 2 }}>{fmtRelative(v.last_heartbeat_at)}</div>
            {v.next_heartbeat_at && v.cadence !== "manual" && (
              <>
                <div style={{ fontSize: 9, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase", marginTop: 6 }}>next</div>
                <div style={{ fontSize: 12, color: SAGE, marginTop: 2 }}>{fmtRelative(v.next_heartbeat_at)}</div>
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <Metric label="queued" value={String(v.queued_decisions)} color={v.queued_decisions > 0 ? AMBER : SAGE} />
          <Metric label="signals in" value={String(v.unprocessed_signals)} color={v.unprocessed_signals > 0 ? BLUE : SAGE} />
          <Metric label="decisions 7d" value={String(v.recent_decisions_7d)} color={LAVENDER} />
          <Metric label="latest revenue" value={fmtMoney(v.latest_revenue_pence)} color={MINT} />
          <Metric label="runway" value={fmtMoney(v.runway_pence)} color={burnPct >= 90 ? SALMON : burnPct >= 70 ? AMBER : SAGE} />
        </div>

        <div style={{ marginTop: 10, height: 4, background: `${TAUPE}22`, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${burnPct}%`, height: "100%", background: burnPct >= 90 ? SALMON : burnPct >= 70 ? AMBER : MINT }} />
        </div>
        <div style={{ marginTop: 4, fontSize: 9, letterSpacing: "0.1em", color: TAUPE, textTransform: "uppercase" }}>
          {fmtMoney(v.spent_pence)} of {fmtMoney(v.budget_pence)} deployed · {burnPct}%
        </div>
      </div>
    </Link>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, background: "#0c0c0c", padding: "10px 12px", borderRadius: 2 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, color, marginTop: 2, fontFamily: "Georgia, serif", fontStyle: "italic" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: TAUPE, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 14, color, marginTop: 2, fontFamily: "Georgia, serif" }}>{value}</div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase", marginRight: 4 }}>{label}</span>
      {children}
    </div>
  );
}

function Pill({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${color}20` : "transparent",
        color: active ? color : TAUPE,
        border: `1px solid ${active ? color : TAUPE}55`,
        padding: "4px 8px",
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: "pointer",
        borderRadius: 2,
      }}
    >
      {children}
    </button>
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

function primaryBtn(color: string): React.CSSProperties {
  return {
    background: color,
    color: "#0a0a0a",
    border: "none",
    padding: "8px 14px",
    fontSize: 11,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    cursor: "pointer",
    borderRadius: 2,
    fontWeight: 600,
  };
}
