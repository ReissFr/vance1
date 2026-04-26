"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type TriggerKind =
  | "cron"
  | "location_arrived"
  | "location_left"
  | "email_received"
  | "bank_txn"
  | "payment_received"
  | "calendar_event";

type RunStatus = "queued" | "running" | "awaiting_approval" | "done" | "failed" | "skipped";

interface Run {
  id: string;
  automation_id: string;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
}

interface Automation {
  id: string;
  title: string;
  description: string | null;
  trigger_kind: TriggerKind;
  trigger_spec: Record<string, unknown>;
  action_chain: unknown[];
  ask_first: boolean;
  enabled: boolean;
  last_fired_at: string | null;
  fire_count: number;
  next_fire_at: string | null;
  created_at: string;
  recent_runs: Run[];
}

const TRIGGER_LABEL: Record<TriggerKind, string> = {
  cron: "Schedule",
  location_arrived: "Arrive at",
  location_left: "Leave",
  email_received: "Email",
  bank_txn: "Bank transaction",
  payment_received: "Payment",
  calendar_event: "Before event",
};

const TRIGGER_COLOR: Record<TriggerKind, string> = {
  cron: "#7a8fff",
  location_arrived: "#7affcb",
  location_left: "#ffb27a",
  email_received: "#c49cff",
  bank_txn: "#ff9eb5",
  payment_received: "#ffd27a",
  calendar_event: "#9ae0ff",
};

function formatTrigger(a: Automation): string {
  const spec = a.trigger_spec as Record<string, unknown>;
  switch (a.trigger_kind) {
    case "cron": {
      const rrule = spec.rrule ?? spec.cron ?? "schedule";
      return String(rrule);
    }
    case "location_arrived":
    case "location_left":
      return String(spec.place_name ?? spec.name ?? "a place");
    case "email_received":
      return String(spec.from ?? spec.subject ?? spec.query ?? "inbox");
    case "bank_txn":
      return String(spec.min_amount ?? "any amount");
    case "payment_received":
      return String(spec.min_amount ?? "any amount");
    case "calendar_event":
      return String(spec.lead_minutes ?? 15) + "m before";
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const past = diff >= 0;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < 60 * 1000) return past ? "just now" : "now";
  if (abs < hour) return (past ? "" : "in ") + Math.round(abs / min) + "m" + (past ? " ago" : "");
  if (abs < day) return (past ? "" : "in ") + Math.round(abs / hour) + "h" + (past ? " ago" : "");
  return (past ? "" : "in ") + Math.round(abs / day) + "d" + (past ? " ago" : "");
}

const RUN_COLOR: Record<RunStatus, string> = {
  queued: "#9ca3af",
  running: "#7a8fff",
  awaiting_approval: "#ffd27a",
  done: "#7affcb",
  failed: "#ff6b6b",
  skipped: "#6b7280",
};

interface Stats7d {
  total: number;
  done: number;
  failed: number;
  awaiting_approval: number;
}

export function AutomationsConsole() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [stats7d, setStats7d] = useState<Stats7d | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [firing, setFiring] = useState<Set<string>>(new Set());
  const [fireFlash, setFireFlash] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automations", { cache: "no-store" });
      const data = (await res.json()) as {
        automations: Automation[];
        stats_7d?: Stats7d;
      };
      setAutomations(data.automations ?? []);
      setStats7d(data.stats_7d ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      setBusyId(id);
      setAutomations((list) =>
        list.map((a) => (a.id === id ? { ...a, enabled } : a)),
      );
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setBusyId(null);
    },
    [],
  );

  const toggleAskFirst = useCallback(
    async (id: string, ask_first: boolean) => {
      setBusyId(id);
      setAutomations((list) =>
        list.map((a) => (a.id === id ? { ...a, ask_first } : a)),
      );
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ask_first }),
      });
      setBusyId(null);
    },
    [],
  );

  const fire = useCallback(
    async (id: string) => {
      setFiring((s) => new Set(s).add(id));
      try {
        const res = await fetch(`/api/automations/${id}/fire`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          run_id?: string;
          error?: string;
        };
        if (!res.ok || !body.ok) throw new Error(body.error ?? "test-fire failed");
        setFireFlash((m) => ({ ...m, [id]: "FIRED" }));
        setTimeout(() => {
          setFireFlash((m) => {
            const { [id]: _drop, ...rest } = m;
            return rest;
          });
          void load();
        }, 2500);
      } catch (e) {
        setFireFlash((m) => ({
          ...m,
          [id]: e instanceof Error ? e.message : "failed",
        }));
        setTimeout(() => {
          setFireFlash((m) => {
            const { [id]: _drop, ...rest } = m;
            return rest;
          });
        }, 4000);
      } finally {
        setFiring((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Delete this automation?")) return;
      setBusyId(id);
      const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAutomations((list) => list.filter((a) => a.id !== id));
      }
      setBusyId(null);
    },
    [],
  );

  const enabled = automations.filter((a) => a.enabled);
  const disabled = automations.filter((a) => !a.enabled);

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 960 }}>
      <CreateHint />
      {stats7d && stats7d.total > 0 && <StatsHeader s={stats7d} />}

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : automations.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Section title={`Armed · ${enabled.length}`}>
            {enabled.map((a) => (
              <AutomationRow
                key={a.id}
                a={a}
                busy={busyId === a.id}
                firing={firing.has(a.id)}
                fireFlash={fireFlash[a.id]}
                onToggle={(v) => toggle(a.id, v)}
                onToggleAsk={(v) => toggleAskFirst(a.id, v)}
                onFire={() => fire(a.id)}
                onDelete={() => remove(a.id)}
              />
            ))}
          </Section>
          {disabled.length > 0 && (
            <Section title={`Off · ${disabled.length}`} dim>
              {disabled.map((a) => (
                <AutomationRow
                  key={a.id}
                  a={a}
                  busy={busyId === a.id}
                  firing={firing.has(a.id)}
                  fireFlash={fireFlash[a.id]}
                  onToggle={(v) => toggle(a.id, v)}
                  onToggleAsk={(v) => toggleAskFirst(a.id, v)}
                  onFire={() => fire(a.id)}
                  onDelete={() => remove(a.id)}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function StatsHeader({ s }: { s: Stats7d }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
        marginBottom: 22,
      }}
    >
      <StatChip label="Fired · 7d" value={s.total} color="var(--ink)" />
      <StatChip label="Completed" value={s.done} color={RUN_COLOR.done} />
      {s.awaiting_approval > 0 ? (
        <StatChip
          label="Awaiting you"
          value={s.awaiting_approval}
          color={RUN_COLOR.awaiting_approval}
        />
      ) : (
        <StatChip label="Awaiting you" value={0} color="var(--ink-3)" />
      )}
      <StatChip label="Failed" value={s.failed} color={RUN_COLOR.failed} />
    </div>
  );
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 22,
          fontStyle: "italic",
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CreateHint() {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 14,
        padding: 18,
        marginBottom: 22,
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.6px",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 8,
        }}
      >
        Create an automation
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        Just say what you want. "Every morning at 8, tell me my first meeting."
        "When I arrive at the office, silence my phone." JARVIS will set it up.
      </div>
      <Link
        href="/"
        style={{
          display: "inline-block",
          marginTop: 12,
          fontSize: 12,
          color: "var(--indigo)",
          textDecoration: "none",
          borderBottom: "1px dashed var(--indigo)",
          paddingBottom: 1,
        }}
      >
        Go to the command line →
      </Link>
    </div>
  );
}

function EmptyState() {
  return (
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
      No automations yet. Ask JARVIS to watch for something and do something else.
    </div>
  );
}

function Section({
  title,
  dim,
  children,
}: {
  title: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 26, opacity: dim ? 0.65 : 1 }}>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.6px",
          color: "var(--ink-3)",
          marginBottom: 10,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

interface RunDetail {
  id: string;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  steps: unknown;
  result: unknown;
  error: string | null;
  trigger_payload: unknown;
}

function AutomationRow({
  a,
  busy,
  firing,
  fireFlash,
  onToggle,
  onToggleAsk,
  onFire,
  onDelete,
}: {
  a: Automation;
  busy: boolean;
  firing: boolean;
  fireFlash: string | undefined;
  onToggle: (v: boolean) => void;
  onToggleAsk: (v: boolean) => void;
  onFire: () => void;
  onDelete: () => void;
}) {
  const color = TRIGGER_COLOR[a.trigger_kind];
  const runs = (a.recent_runs ?? []).slice(0, 6);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const openRun = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setRunDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedRunId(runId);
    setDetailLoading(true);
    setRunDetail(null);
    setDetailError(null);
    try {
      const res = await fetch(`/api/automations/runs/${runId}`, { cache: "no-store" });
      const body = (await res.json()) as { run?: RunDetail; error?: string };
      if (!res.ok || !body.run) throw new Error(body.error ?? "failed");
      setRunDetail(body.run);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setDetailLoading(false);
    }
  }, [expandedRunId]);
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 4,
          alignSelf: "stretch",
          borderRadius: 2,
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
            lineHeight: 1.35,
          }}
        >
          {a.title}
        </div>
        {a.description && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {a.description}
          </div>
        )}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            gap: 12,
            alignItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ color }}>
            {TRIGGER_LABEL[a.trigger_kind]}: {formatTrigger(a)}
          </span>
          {a.trigger_kind === "cron" && a.next_fire_at && (
            <span>NEXT {formatRelative(a.next_fire_at)}</span>
          )}
          {a.last_fired_at && <span>LAST {formatRelative(a.last_fired_at)}</span>}
          <span>FIRED {a.fire_count}×</span>
          {a.ask_first && <span style={{ color: "var(--indigo)" }}>ASKS FIRST</span>}
        </div>
        {runs.length > 0 && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 4,
              alignItems: "center",
            }}
            title="Recent run outcomes (oldest → newest) — click a dot to see steps"
          >
            {runs
              .slice()
              .reverse()
              .map((r) => {
                const isActive = expandedRunId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openRun(r.id)}
                    title={`${r.status}${r.completed_at ? ` · ${formatRelative(r.completed_at)}` : ""}`}
                    style={{
                      width: 11,
                      height: 11,
                      padding: 0,
                      borderRadius: "50%",
                      background: RUN_COLOR[r.status],
                      border: isActive
                        ? "1px solid var(--ink)"
                        : r.status === "running"
                        ? `2px solid ${RUN_COLOR.running}33`
                        : "1px solid transparent",
                      cursor: "pointer",
                      boxShadow: isActive
                        ? "0 0 0 2px var(--indigo-soft, var(--indigo))"
                        : "none",
                    }}
                  />
                );
              })}
          </div>
        )}
        {expandedRunId && (
          <RunDetailPanel
            loading={detailLoading}
            error={detailError}
            run={runDetail}
            onClose={() => {
              setExpandedRunId(null);
              setRunDetail(null);
              setDetailError(null);
            }}
          />
        )}
        {fireFlash && (
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.6px",
              color: fireFlash === "FIRED" ? "var(--indigo)" : "var(--magenta, #ff6b6b)",
              textTransform: "uppercase",
            }}
          >
            {fireFlash}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        <Switch
          value={a.enabled}
          busy={busy}
          onChange={onToggle}
          label={a.enabled ? "ON" : "OFF"}
        />
        <button
          onClick={() => onToggleAsk(!a.ask_first)}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--ink-3)",
            background: "transparent",
            border: "1px solid var(--rule)",
            borderRadius: 5,
            padding: "3px 7px",
            cursor: "pointer",
            letterSpacing: "0.4px",
          }}
        >
          {a.ask_first ? "ASK FIRST" : "AUTO"}
        </button>
        <button
          onClick={onFire}
          disabled={firing}
          title="Fire once now — bypasses trigger matching"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--indigo)",
            background: "transparent",
            border: "1px solid var(--indigo-soft, var(--indigo))",
            borderRadius: 5,
            padding: "3px 7px",
            cursor: firing ? "wait" : "pointer",
            letterSpacing: "0.4px",
            opacity: firing ? 0.5 : 1,
          }}
        >
          {firing ? "…" : "TEST FIRE"}
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--ink-3)",
            background: "transparent",
            border: "1px solid var(--rule)",
            borderRadius: 5,
            padding: "3px 7px",
            cursor: "pointer",
            letterSpacing: "0.4px",
          }}
        >
          DELETE
        </button>
      </div>
    </div>
  );
}

function RunDetailPanel({
  loading,
  error,
  run,
  onClose,
}: {
  loading: boolean;
  error: string | null;
  run: RunDetail | null;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        background: "var(--bg)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        color: "var(--ink-2)",
        letterSpacing: "0.2px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.8px",
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          Run detail
        </span>
        {run && (
          <span style={{ color: RUN_COLOR[run.status], textTransform: "uppercase" }}>
            {run.status}
          </span>
        )}
        {run?.completed_at && (
          <span style={{ color: "var(--ink-3)" }}>
            {formatRelative(run.completed_at)}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: "auto",
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--ink-3)",
            background: "transparent",
            border: "1px solid var(--rule)",
            borderRadius: 4,
            padding: "2px 6px",
            cursor: "pointer",
            letterSpacing: "0.4px",
          }}
        >
          CLOSE
        </button>
      </div>
      {loading && <div style={{ color: "var(--ink-3)" }}>Loading…</div>}
      {error && <div style={{ color: "var(--magenta, #ff6b6b)" }}>{error}</div>}
      {run && !loading && <RunSteps run={run} />}
    </div>
  );
}

function RunSteps({ run }: { run: RunDetail }) {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {steps.length === 0 && !run.error && (
        <div style={{ color: "var(--ink-3)" }}>No steps recorded.</div>
      )}
      {steps.map((s, i) => {
        const step = (s ?? {}) as Record<string, unknown>;
        const tool = String(step.tool ?? step.step ?? "step");
        const status = step.status as string | undefined;
        const argsRaw = step.args ?? step.input ?? null;
        const outputRaw = step.output ?? step.result ?? null;
        return (
          <div key={i} style={{ borderLeft: "2px solid var(--rule)", paddingLeft: 8 }}>
            <div>
              <span style={{ color: "var(--indigo)" }}>[{i + 1}]</span>{" "}
              <span style={{ color: "var(--ink)" }}>{tool}</span>
              {status && (
                <span style={{ color: "var(--ink-3)", marginLeft: 8 }}>{status}</span>
              )}
            </div>
            {argsRaw != null && (
              <pre
                style={{
                  margin: "4px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--ink-3)",
                  fontSize: 10.5,
                  lineHeight: 1.4,
                }}
              >
                {truncateJson(argsRaw, 1000)}
              </pre>
            )}
            {outputRaw != null && (
              <pre
                style={{
                  margin: "4px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--ink-2)",
                  fontSize: 10.5,
                  lineHeight: 1.4,
                }}
              >
                ↳ {truncateJson(outputRaw, 1000)}
              </pre>
            )}
          </div>
        );
      })}
      {run.error && (
        <div style={{ color: "var(--magenta, #ff6b6b)", marginTop: 4 }}>
          ERROR · {run.error}
        </div>
      )}
      {run.result != null && (
        <details style={{ marginTop: 4 }}>
          <summary
            style={{
              cursor: "pointer",
              color: "var(--ink-3)",
              fontSize: 10,
              letterSpacing: "0.6px",
            }}
          >
            RESULT
          </summary>
          <pre
            style={{
              margin: "4px 0 0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--ink-2)",
              fontSize: 10.5,
            }}
          >
            {truncateJson(run.result, 2000)}
          </pre>
        </details>
      )}
    </div>
  );
}

function truncateJson(v: unknown, max: number): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function Switch({
  value,
  busy,
  onChange,
  label,
}: {
  value: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => !busy && onChange(!value)}
      disabled={busy}
      title={label}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        background: value ? "var(--indigo)" : "var(--rule)",
        position: "relative",
        border: "none",
        cursor: busy ? "wait" : "pointer",
        transition: "background 200ms",
        opacity: busy ? 0.7 : 1,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: value ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: 999,
          background: "#fff",
          transition: "left 200ms",
        }}
      />
    </button>
  );
}
