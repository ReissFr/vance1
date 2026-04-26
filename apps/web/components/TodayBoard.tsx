"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "./jarvis/ToastHost";

type CalendarEvent = {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
};

type RevenueSummary = {
  provider: string;
  currency: string;
  gross: number;
  net: number;
  count: number;
};

type SubscriptionRenewal = {
  id: string;
  service_name: string;
  amount: number | null;
  currency: string;
  next_renewal_date: string | null;
  cadence: string;
};

type ActivityItem = {
  id: string;
  kind: string;
  status: string;
  title: string;
  completed_at: string | null;
  created_at: string;
  cost_usd: number | null;
};

type DueCommitment = {
  id: string;
  direction: "inbound" | "outbound";
  other_party: string;
  commitment_text: string;
  deadline: string | null;
  overdue: boolean;
};

type ScheduledTask = {
  id: string;
  kind: string;
  title: string;
  scheduled_at: string;
};

type Summary = {
  display_name: string | null;
  timezone: string | null;
  calendar: CalendarEvent[] | null;
  revenue: { today: RevenueSummary[]; mtd: RevenueSummary[] } | null;
  subscriptions: SubscriptionRenewal[];
  counts: {
    approvals: number;
    active: number;
    queued: number;
    armed_automations: number;
  };
  briefing: { text: string; at: string } | null;
  activity: ActivityItem[];
  commitments: DueCommitment[];
  scheduled: ScheduledTask[];
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

const STAT: React.CSSProperties = {
  fontFamily: "var(--serif)",
  fontStyle: "italic",
  fontSize: 32,
  letterSpacing: "-0.4px",
  color: "var(--ink)",
  lineHeight: 1,
};

const STAT_SUB: React.CSSProperties = {
  marginTop: 6,
  fontFamily: "var(--sans)",
  fontSize: 12,
  color: "var(--ink-3)",
};

function formatTime(iso: string | null, tz: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz ?? undefined,
  });
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `${(usd * 100).toFixed(2)}¢`;
  if (usd < 1) return `${(usd * 100).toFixed(1)}¢`;
  return `$${usd.toFixed(2)}`;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency.toUpperCase()}`;
  }
}

function sumRevenue(rows: RevenueSummary[] | undefined): number {
  if (!rows) return 0;
  return rows.reduce((a, r) => a + (r.net ?? 0), 0);
}

function revenueCurrency(rows: RevenueSummary[] | undefined): string {
  return rows?.[0]?.currency ?? "GBP";
}

function timeGreeting(name: string | null): string {
  const hour = new Date().getHours();
  const part =
    hour < 5 ? "Still awake"
    : hour < 12 ? "Good morning"
    : hour < 17 ? "Good afternoon"
    : hour < 22 ? "Good evening"
    : "Still going";
  return name ? `${part}, ${name}.` : `${part}.`;
}

export function TodayBoard() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/today/summary", { cache: "no-store" });
        if (res.ok) {
          setData((await res.json()) as Summary);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 32, color: "var(--ink-3)", fontSize: 13 }}>
        Gathering today…
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: 32, color: "var(--ink-3)", fontSize: 13 }}>
        Couldn't load today.
      </div>
    );
  }

  const now = new Date();
  const nextEvent = (data.calendar ?? []).find((e) => {
    if (!e.start) return false;
    return new Date(e.start).getTime() >= now.getTime();
  });

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 1180 }}>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 26,
          color: "var(--ink)",
          marginBottom: 22,
        }}
      >
        {timeGreeting(data.display_name)}
      </div>

      <IntegrationHealthBanner />
      <HeadsUpBanner />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <StatCard
          label="Approvals waiting"
          value={data.counts.approvals}
          sub={data.counts.approvals ? "You have to say yes" : "All clear"}
          href="/operations"
        />
        <StatCard
          label="Active errands"
          value={data.counts.active + data.counts.queued}
          sub={`${data.counts.active} running · ${data.counts.queued} queued`}
          href="/operations"
        />
        <StatCard
          label="Automations armed"
          value={data.counts.armed_automations}
          sub="Watching for triggers"
          href="/features"
        />
        <StatCard
          label="Next event"
          valueText={nextEvent?.summary ?? "Nothing scheduled"}
          sub={
            nextEvent?.start
              ? `${formatTime(nextEvent.start, data.timezone)}${nextEvent.location ? " · " + nextEvent.location : ""}`
              : "Enjoy the quiet"
          }
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <CalendarCard events={data.calendar} tz={data.timezone} />
        <RevenueCard revenue={data.revenue} />
      </div>

      {data.commitments.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <CommitmentsDueCard commitments={data.commitments} />
        </div>
      )}

      {data.scheduled.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <ScheduledCard
            scheduled={data.scheduled}
            tz={data.timezone}
            onCancel={(id) =>
              setData((prev) =>
                prev ? { ...prev, scheduled: prev.scheduled.filter((t) => t.id !== id) } : prev,
              )
            }
            onSnooze={(id, nextIso) =>
              setData((prev) =>
                prev
                  ? {
                      ...prev,
                      scheduled: prev.scheduled
                        .map((t) => (t.id === id ? { ...t, scheduled_at: nextIso } : t))
                        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
                    }
                  : prev,
              )
            }
          />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <SubscriptionsCard subs={data.subscriptions} />
        <BriefingCard briefing={data.briefing} />
      </div>

      <ActivityCard activity={data.activity} tz={data.timezone} />
    </div>
  );
}

function CommitmentsDueCard({ commitments }: { commitments: DueCommitment[] }) {
  const overdue = commitments.filter((c) => c.overdue);
  const due = commitments.filter((c) => !c.overdue);
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>
        Commitments · {commitments.length}
        {overdue.length > 0 && ` · ${overdue.length} overdue`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {overdue.map((c) => (
          <CommitmentLine key={c.id} c={c} />
        ))}
        {due.map((c) => (
          <CommitmentLine key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function CommitmentLine({ c }: { c: DueCommitment }) {
  const deadlineLabel = c.deadline
    ? c.overdue
      ? "OVERDUE"
      : "TODAY"
    : "—";
  return (
    <Link
      href="/commitments"
      style={{
        display: "flex",
        gap: 14,
        alignItems: "baseline",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          width: 82,
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: c.overdue ? "#ff6b6b" : "var(--violet)",
          letterSpacing: "0.6px",
          flexShrink: 0,
        }}
      >
        {deadlineLabel}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--ink)",
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {c.commitment_text}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
            marginTop: 2,
            textTransform: "uppercase",
          }}
        >
          {c.direction === "outbound" ? "YOU OWE" : "THEY OWE"} · {c.other_party}
        </div>
      </div>
    </Link>
  );
}

function ScheduledCard({
  scheduled,
  tz,
  onCancel,
  onSnooze,
}: {
  scheduled: ScheduledTask[];
  tz: string | null;
  onCancel: (id: string) => void;
  onSnooze: (id: string, nextIso: string) => void;
}) {
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>Coming up · {scheduled.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {scheduled.map((t) => (
          <ScheduledLine key={t.id} t={t} tz={tz} onCancel={onCancel} onSnooze={onSnooze} />
        ))}
      </div>
    </div>
  );
}

function ScheduledLine({
  t,
  tz,
  onCancel,
  onSnooze,
}: {
  t: ScheduledTask;
  tz: string | null;
  onCancel: (id: string) => void;
  onSnooze: (id: string, nextIso: string) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const time = formatTime(t.scheduled_at, tz);
  const label = SCHEDULED_KIND_LABEL[t.kind] ?? KIND_LABEL[t.kind] ?? t.kind;

  const doCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/tasks/${t.id}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "cancel failed");
      onCancel(t.id);
      toast({ variant: "success", title: "Scheduled task cancelled" });
    } catch (err) {
      toast({
        variant: "error",
        title: "Cancel failed",
        body: err instanceof Error ? err.message : String(err),
      });
      setCancelling(false);
    }
  };

  const doSnooze = async (e: React.MouseEvent, minutes: number, label: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (snoozing || cancelling) return;
    setSnoozing(true);
    try {
      const res = await fetch(`/api/tasks/${t.id}/snooze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        scheduled_at?: string;
      };
      if (!res.ok || !body.ok || !body.scheduled_at) throw new Error(body.error ?? "snooze failed");
      onSnooze(t.id, body.scheduled_at);
      toast({ variant: "success", title: `Snoozed ${label}` });
    } catch (err) {
      toast({
        variant: "error",
        title: "Snooze failed",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSnoozing(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "baseline",
      }}
    >
      <Link
        href={`/history?task=${t.id}`}
        style={{
          display: "flex",
          gap: 14,
          alignItems: "baseline",
          textDecoration: "none",
          color: "inherit",
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 62,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--indigo)",
            letterSpacing: "0.6px",
            flexShrink: 0,
          }}
        >
          {time}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              color: "var(--ink)",
              lineHeight: 1.4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {t.title}
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
              marginTop: 2,
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
        </div>
      </Link>
      <button
        type="button"
        onClick={(e) => doSnooze(e, 60, "1 hour")}
        disabled={snoozing || cancelling}
        title="Snooze 1 hour"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.8px",
          padding: "4px 8px",
          background: "transparent",
          color: "var(--ink-3)",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          cursor: snoozing || cancelling ? "wait" : "pointer",
          opacity: snoozing || cancelling ? 0.5 : 1,
          flexShrink: 0,
          marginRight: 4,
        }}
      >
        +1H
      </button>
      <button
        type="button"
        onClick={(e) => doSnooze(e, 60 * 24, "1 day")}
        disabled={snoozing || cancelling}
        title="Snooze 1 day"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.8px",
          padding: "4px 8px",
          background: "transparent",
          color: "var(--ink-3)",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          cursor: snoozing || cancelling ? "wait" : "pointer",
          opacity: snoozing || cancelling ? 0.5 : 1,
          flexShrink: 0,
          marginRight: 4,
        }}
      >
        +1D
      </button>
      <button
        type="button"
        onClick={doCancel}
        disabled={cancelling}
        title="Cancel scheduled task"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.8px",
          padding: "4px 8px",
          background: "transparent",
          color: "var(--ink-3)",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          cursor: cancelling ? "wait" : "pointer",
          opacity: cancelling ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {cancelling ? "…" : "CANCEL"}
      </button>
    </div>
  );
}

const SCHEDULED_KIND_LABEL: Record<string, string> = {
  ops: "Reminder",
  reminder: "Reminder",
  briefing: "Morning briefing",
  evening_wrap: "Evening wrap",
  weekly_review: "Weekly review",
  subscriptions_scan: "Subscriptions sweep",
  receipts_scan: "Receipts sweep",
  commitments_scan: "Commitments sweep",
};

const KIND_LABEL: Record<string, string> = {
  writer: "Drafted",
  outreach: "Outreach",
  researcher: "Research",
  research: "Research",
  inbox: "Triaged inbox",
  code: "Code agent",
  crypto: "Crypto",
  ops: "Reminder",
  errand: "Errand",
  briefing: "Morning briefing",
  evening_wrap: "Evening wrap",
  weekly_review: "Weekly review",
  subscriptions_scan: "Subscriptions sweep",
  receipts_scan: "Receipts sweep",
  commitments_scan: "Commitments sweep",
  meeting_ghost: "Meeting",
};

const STATUS_COLOR: Record<string, string> = {
  done: "var(--indigo)",
  needs_approval: "#ffb27a",
  failed: "#ff6b6b",
};

const STATUS_LABEL: Record<string, string> = {
  done: "done",
  needs_approval: "needs approval",
  failed: "failed",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

const RETRYABLE_KINDS = new Set([
  "briefing",
  "evening_wrap",
  "weekly_review",
  "receipts_scan",
  "subscription_scan",
  "subscriptions_scan",
  "commitments_scan",
  "inbox",
  "writer",
  "outreach",
  "research",
  "researcher",
  "errand",
]);

function ActivityCard({
  activity,
  tz,
}: {
  activity: ActivityItem[];
  tz: string | null;
}) {
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [retriedIds, setRetriedIds] = useState<Set<string>>(new Set());

  const retry = async (id: string) => {
    if (retrying.has(id)) return;
    setRetrying((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/tasks/${id}/retry`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "retry failed");
      setRetriedIds((s) => new Set(s).add(id));
      toast({ variant: "success", title: "Task requeued" });
    } catch (err) {
      toast({
        variant: "error",
        title: "Retry failed",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRetrying((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  if (activity.length === 0) {
    return (
      <div style={CARD}>
        <div style={CARD_TITLE}>What JARVIS did today</div>
        <EmptyState text="Nothing yet today. Ask me something." />
      </div>
    );
  }
  const totalCost = activity.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0);
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>
        What JARVIS did today · {activity.length}
        {totalCost > 0 && ` · ${formatCost(totalCost)}`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {activity.slice(0, 20).map((a) => {
          const when = a.completed_at ?? a.created_at;
          const color = STATUS_COLOR[a.status] ?? "var(--ink-4)";
          const canRetry = a.status === "failed" && RETRYABLE_KINDS.has(a.kind);
          const isRetrying = retrying.has(a.id);
          const wasRetried = retriedIds.has(a.id);
          return (
            <div
              key={a.id}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "baseline",
              }}
            >
              <Link
                href={`/history?task=${a.id}`}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "baseline",
                  textDecoration: "none",
                  color: "inherit",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: 62,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    flexShrink: 0,
                  }}
                >
                  {formatTime(when, tz) || "—"}
                </div>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: color,
                    flexShrink: 0,
                    alignSelf: "center",
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--sans)",
                      fontSize: 13.5,
                      color: "var(--ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {a.title}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      letterSpacing: "0.4px",
                      marginTop: 2,
                      textTransform: "uppercase",
                    }}
                  >
                    {kindLabel(a.kind)}
                    {a.status !== "done" && ` · ${STATUS_LABEL[a.status] ?? a.status}`}
                    {a.cost_usd != null && a.cost_usd > 0 && ` · ${formatCost(a.cost_usd)}`}
                  </div>
                </div>
              </Link>
              {canRetry && (
                <button
                  type="button"
                  onClick={() => void retry(a.id)}
                  disabled={isRetrying || wasRetried}
                  title={wasRetried ? "Requeued" : "Retry this task"}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    letterSpacing: "0.8px",
                    padding: "4px 8px",
                    background: "transparent",
                    color: wasRetried ? "var(--indigo)" : "var(--ink-3)",
                    border: `1px solid ${wasRetried ? "var(--indigo)" : "var(--rule)"}`,
                    borderRadius: 6,
                    cursor: isRetrying ? "wait" : wasRetried ? "default" : "pointer",
                    opacity: isRetrying ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  {isRetrying ? "…" : wasRetried ? "QUEUED" : "RETRY"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueText,
  sub,
  href,
}: {
  label: string;
  value?: number;
  valueText?: string;
  sub: string;
  href?: string;
}) {
  const content = (
    <div style={{ ...CARD, minHeight: 110 }}>
      <div style={CARD_TITLE}>{label}</div>
      {value != null ? (
        <div style={STAT}>{value}</div>
      ) : (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--ink)",
            fontWeight: 500,
            lineHeight: 1.3,
          }}
        >
          {valueText}
        </div>
      )}
      <div style={STAT_SUB}>{sub}</div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {content}
      </Link>
    );
  }
  return content;
}

function CalendarCard({
  events,
  tz,
}: {
  events: CalendarEvent[] | null;
  tz: string | null;
}) {
  if (events === null) {
    return (
      <div style={CARD}>
        <div style={CARD_TITLE}>Today's calendar</div>
        <EmptyState
          text="Connect Google to see today."
          cta="Integrations"
          href="/integrations"
        />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div style={CARD}>
        <div style={CARD_TITLE}>Today's calendar</div>
        <EmptyState text="No events today." />
      </div>
    );
  }
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>Today's calendar · {events.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.slice(0, 8).map((e) => (
          <EventRow key={e.id} event={e} tz={tz} />
        ))}
      </div>
    </div>
  );
}

type PrepRelated = {
  source: string;
  title: string | null;
  snippet: string;
  occurred_at: string | null;
};
type PrepCommitment = {
  id: string;
  direction: "outbound" | "inbound";
  other_party: string;
  other_party_email: string | null;
  commitment_text: string;
  deadline: string | null;
};
type PrepData = {
  related: PrepRelated[];
  commitments: PrepCommitment[];
};

function EventRow({ event, tz }: { event: CalendarEvent; tz: string | null }) {
  const [open, setOpen] = useState(false);
  const [prep, setPrep] = useState<PrepData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function togglePrep() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (prep || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/calendar/prep?event_id=${encodeURIComponent(event.id)}`,
      );
      if (!r.ok) throw new Error(`${r.status}`);
      const body = (await r.json()) as PrepData;
      setPrep(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--sans)",
        fontSize: 13.5,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
        <div
          style={{
            width: 62,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--indigo)",
            flexShrink: 0,
          }}
        >
          {formatTime(event.start, tz) || "all-day"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: "var(--ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {event.summary}
          </div>
          {event.location && (
            <div
              style={{
                fontSize: 11.5,
                color: "var(--ink-3)",
                marginTop: 2,
              }}
            >
              {event.location}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={togglePrep}
          style={{
            background: "transparent",
            border: "1px solid var(--ink-3)",
            borderRadius: 4,
            color: "var(--ink-2)",
            cursor: "pointer",
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: 0.5,
            padding: "3px 8px",
            flexShrink: 0,
          }}
        >
          {open ? "HIDE" : "PREP"}
        </button>
      </div>
      {open && (
        <div
          style={{
            marginLeft: 76,
            marginTop: 8,
            padding: "8px 10px",
            borderLeft: "2px solid var(--ink-4)",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--ink-2)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {loading && <div>loading…</div>}
          {error && <div style={{ color: "var(--red)" }}>prep failed: {error}</div>}
          {prep && (
            <>
              {prep.commitments.length > 0 && (
                <div>
                  <div style={{ color: "var(--ink-3)", marginBottom: 3 }}>
                    OPEN PROMISES
                  </div>
                  {prep.commitments.map((c) => (
                    <div key={c.id} style={{ marginBottom: 2 }}>
                      · {c.direction === "outbound" ? "I owe" : "they owe"}{" "}
                      <span style={{ color: "var(--ink)" }}>{c.other_party}</span>:{" "}
                      {c.commitment_text}
                      {c.deadline && (
                        <span style={{ color: "var(--ink-3)" }}>
                          {" "}
                          (due {new Date(c.deadline).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {prep.related.length > 0 && (
                <div>
                  <div style={{ color: "var(--ink-3)", marginBottom: 3 }}>
                    RECENT CONTEXT
                  </div>
                  {prep.related.map((h, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      · [{h.source}]{" "}
                      {h.title && (
                        <span style={{ color: "var(--ink)" }}>{h.title} — </span>
                      )}
                      <span style={{ color: "var(--ink-3)" }}>{h.snippet}</span>
                    </div>
                  ))}
                </div>
              )}
              {prep.commitments.length === 0 && prep.related.length === 0 && (
                <div style={{ color: "var(--ink-3)" }}>
                  no prior context found.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RevenueCard({
  revenue,
}: {
  revenue: Summary["revenue"];
}) {
  if (!revenue) {
    return (
      <div style={CARD}>
        <div style={CARD_TITLE}>Revenue</div>
        <EmptyState
          text="Connect a payment provider to see revenue."
          cta="Integrations"
          href="/integrations"
        />
      </div>
    );
  }
  const todayTotal = sumRevenue(revenue.today);
  const mtdTotal = sumRevenue(revenue.mtd);
  const currency = revenueCurrency(revenue.today) || revenueCurrency(revenue.mtd);
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>Revenue</div>
      <div style={{ display: "flex", gap: 28 }}>
        <div>
          <div style={STAT}>{formatMoney(todayTotal, currency)}</div>
          <div style={STAT_SUB}>Today</div>
        </div>
        <div>
          <div style={{ ...STAT, color: "var(--ink-2)" }}>
            {formatMoney(mtdTotal, currency)}
          </div>
          <div style={STAT_SUB}>Month to date</div>
        </div>
      </div>
      {revenue.today.length > 0 && (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {revenue.today.map((r) => (
            <div
              key={r.provider}
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ textTransform: "capitalize" }}>{r.provider}</span>
              <span>
                {formatMoney(r.net, r.currency)} · {r.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SubscriptionsCard({ subs }: { subs: SubscriptionRenewal[] }) {
  if (subs.length === 0) {
    return (
      <div style={CARD}>
        <div style={CARD_TITLE}>Renewals this week</div>
        <EmptyState text="No renewals in the next 7 days." />
      </div>
    );
  }
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>Renewals this week · {subs.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {subs.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: 13.5,
            }}
          >
            <div>
              <div style={{ color: "var(--ink)" }}>{s.service_name}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                {s.cadence}{" "}
                {s.next_renewal_date
                  ? `· ${new Date(s.next_renewal_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
                  : ""}
              </div>
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)" }}>
              {s.amount != null ? formatMoney(s.amount, s.currency) : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefingCard({ briefing }: { briefing: Summary["briefing"] }) {
  if (!briefing) {
    return (
      <div style={CARD}>
        <div style={CARD_TITLE}>Latest briefing</div>
        <EmptyState
          text="No briefing yet."
          cta="Turn on morning briefings"
          href="/morning-briefing"
        />
      </div>
    );
  }
  return (
    <div style={CARD}>
      <div style={CARD_TITLE}>
        Latest briefing · {new Date(briefing.at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "var(--ink-2)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          maxHeight: 280,
          overflow: "auto",
        }}
      >
        {briefing.text.slice(0, 1600)}
      </div>
    </div>
  );
}

function EmptyState({
  text,
  cta,
  href,
}: {
  text: string;
  cta?: string;
  href?: string;
}) {
  return (
    <div
      style={{
        padding: "14px 0 6px",
        color: "var(--ink-3)",
        fontFamily: "var(--sans)",
        fontSize: 13,
      }}
    >
      <div>{text}</div>
      {cta && href && (
        <Link
          href={href}
          style={{
            display: "inline-block",
            marginTop: 10,
            fontSize: 12,
            color: "var(--indigo)",
            textDecoration: "none",
            borderBottom: "1px dashed var(--indigo)",
            paddingBottom: 1,
          }}
        >
          {cta} →
        </Link>
      )}
    </div>
  );
}

type IntegrationHealthRow = {
  key: string;
  kind: string;
  provider: string;
  connected: boolean;
  expires_at: string | null;
};

const INTEGRATION_NAME: Record<string, string> = {
  gmail: "Gmail",
  gcal: "Google Calendar",
  stripe: "Stripe",
  paypal: "PayPal",
  square: "Square",
  shopify: "Shopify",
  xero: "Xero",
  quickbooks: "QuickBooks",
  freeagent: "FreeAgent",
  smartthings: "SmartThings",
  truelayer: "TrueLayer",
  monzo: "Monzo",
  plaid: "Plaid",
  coinbase: "Coinbase",
  kraken: "Kraken",
  notion: "Notion",
  github: "GitHub",
  slack: "Slack",
  calcom: "Cal.com",
  linear: "Linear",
  todoist: "Todoist",
  resend: "Resend",
  google_drive: "Google Drive",
};

function IntegrationHealthBanner() {
  const [issues, setIssues] = useState<
    Array<{ key: string; name: string; severity: "expired" | "expiring"; days: number }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations/list", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ integrations?: IntegrationHealthRow[] }>)
      .then((d) => {
        if (cancelled) return;
        const now = Date.now();
        const found: Array<{
          key: string;
          name: string;
          severity: "expired" | "expiring";
          days: number;
        }> = [];
        for (const row of d.integrations ?? []) {
          if (!row.connected || !row.expires_at) continue;
          const exp = new Date(row.expires_at).getTime();
          if (Number.isNaN(exp)) continue;
          const days = Math.floor((exp - now) / (24 * 3600 * 1000));
          const name = INTEGRATION_NAME[row.key] ?? row.key;
          if (exp <= now) {
            found.push({ key: row.key, name, severity: "expired", days: 0 });
          } else if (days <= 7) {
            found.push({ key: row.key, name, severity: "expiring", days });
          }
        }
        setIssues(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (issues.length === 0) return null;

  const hasExpired = issues.some((i) => i.severity === "expired");
  const color = hasExpired ? "var(--magenta, #ff6b6b)" : "var(--violet, #a78bfa)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        marginBottom: 14,
        border: `1px solid ${color}`,
        background: "var(--surface)",
        borderRadius: 10,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.4px",
          color,
          textTransform: "uppercase",
        }}
      >
        {hasExpired ? "Integration expired" : "Expiring soon"}
      </span>
      <span
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "var(--ink-2)",
          flex: 1,
          minWidth: 0,
        }}
      >
        {issues
          .map((i) =>
            i.severity === "expired"
              ? `${i.name} (reconnect)`
              : `${i.name} (${i.days}d)`,
          )
          .join(" · ")}
      </span>
      <Link
        href="/integrations"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "0.6px",
          color: "var(--ink)",
          textDecoration: "none",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          padding: "5px 10px",
        }}
      >
        FIX →
      </Link>
    </div>
  );
}

type HeadsUpItem = {
  label: string;
  href: string;
  count: number;
  color: string;
};

function HeadsUpBanner() {
  const [items, setItems] = useState<HeadsUpItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [staleRes, failedRes, budgetRes, subsRes] = await Promise.all([
          fetch("/api/commitments/stale", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/tasks?status=failed&limit=20", { cache: "no-store" }).then((r) =>
            r.json(),
          ),
          fetch("/api/budgets", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { budgets: [] }))
            .catch(() => ({ budgets: [] })),
          fetch("/api/subscriptions", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { subscriptions: [] }))
            .catch(() => ({ subscriptions: [] })),
        ]);
        if (cancelled) return;
        const found: HeadsUpItem[] = [];
        const staleCount = (staleRes as { count?: number })?.count ?? 0;
        if (staleCount > 0) {
          found.push({
            label: `${staleCount} overdue commitment${staleCount === 1 ? "" : "s"}`,
            href: "/commitments",
            count: staleCount,
            color: "var(--magenta, #ff6b6b)",
          });
        }
        const failedTasks = ((failedRes as { tasks?: Array<{ completed_at?: string | null; created_at?: string }> })?.tasks ?? []);
        const dayAgo = Date.now() - 24 * 3600 * 1000;
        const recentFailed = failedTasks.filter((t) => {
          const ts = t.completed_at ?? t.created_at;
          return ts ? new Date(ts).getTime() >= dayAgo : false;
        }).length;
        if (recentFailed > 0) {
          found.push({
            label: `${recentFailed} failed task${recentFailed === 1 ? "" : "s"} · 24h`,
            href: "/operations",
            count: recentFailed,
            color: "var(--violet, #a78bfa)",
          });
        }
        const budgets = ((budgetRes as { budgets?: Array<{ active?: boolean; status?: { state?: string } | null }> })?.budgets ?? []);
        const breached = budgets.filter(
          (b) => b.active !== false && b.status?.state === "breach",
        ).length;
        const warning = budgets.filter(
          (b) => b.active !== false && b.status?.state === "warn",
        ).length;
        if (breached > 0) {
          found.push({
            label: `${breached} budget${breached === 1 ? "" : "s"} over`,
            href: "/budgets",
            count: breached,
            color: "var(--magenta, #ff6b6b)",
          });
        } else if (warning > 0) {
          found.push({
            label: `${warning} budget${warning === 1 ? "" : "s"} near limit`,
            href: "/budgets",
            count: warning,
            color: "#FBBF24",
          });
        }
        const subs = ((subsRes as {
          subscriptions?: Array<{
            status: string;
            cadence: string;
            amount: number | null;
            last_charged_at: string | null;
            last_seen_at: string | null;
          }>;
        })?.subscriptions ?? []);
        const staleSubs = subs.filter((s) => {
          if (s.status !== "active" && s.status !== "trial") return false;
          const threshold =
            s.cadence === "weekly" ? 21 :
            s.cadence === "monthly" ? 60 :
            s.cadence === "quarterly" ? 135 :
            s.cadence === "annual" ? 400 : null;
          if (threshold == null) return false;
          const ref = s.last_charged_at ?? s.last_seen_at;
          if (!ref) return false;
          const t = new Date(ref).getTime();
          if (!Number.isFinite(t)) return false;
          return Math.floor((Date.now() - t) / 86400000) >= threshold;
        });
        if (staleSubs.length > 0) {
          const monthly = staleSubs.reduce((acc, s) => {
            if (s.amount == null) return acc;
            const a = Number(s.amount);
            if (s.cadence === "weekly") return acc + a * 4.33;
            if (s.cadence === "monthly") return acc + a;
            if (s.cadence === "quarterly") return acc + a / 3;
            if (s.cadence === "annual") return acc + a / 12;
            return acc;
          }, 0);
          const amt = monthly >= 1 ? `£${Math.round(monthly)}/mo` : null;
          found.push({
            label: `${staleSubs.length} maybe-unused sub${staleSubs.length === 1 ? "" : "s"}${amt ? ` · ${amt}` : ""}`,
            href: "/money",
            count: staleSubs.length,
            color: "#FBBF24",
          });
        }
        setItems(found);
      } catch {
        // soft-fail
      }
    };
    void run();
    const id = setInterval(run, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (items.length === 0) return null;

  const primaryColor = items[0]?.color ?? "var(--magenta)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        marginBottom: 14,
        border: `1px solid ${primaryColor}`,
        background: "var(--surface)",
        borderRadius: 10,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.4px",
          color: primaryColor,
          textTransform: "uppercase",
        }}
      >
        Heads up
      </span>
      <div
        style={{
          display: "flex",
          gap: 16,
          flex: 1,
          minWidth: 0,
          flexWrap: "wrap",
        }}
      >
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-2)",
              textDecoration: "none",
              borderBottom: `1px dashed ${it.color}`,
              paddingBottom: 1,
            }}
          >
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
