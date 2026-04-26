"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTasks, type TaskRow } from "./jarvis/useTasks";
import { Card, MetricCard, SectionHeading, EmptyState } from "./jarvis/primitives";
import { ApprovalCard } from "./jarvis/ApprovalCard";
import { Chip } from "./jarvis/Chip";
import { toast } from "./jarvis/ToastHost";

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

type Props = {
  fallbackName?: string | null;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function taskTitle(t: TaskRow) {
  const args = (t.args ?? {}) as { title?: string; summary?: string };
  return args.title ?? args.summary ?? t.prompt ?? t.kind;
}

function taskBody(t: TaskRow) {
  const args = (t.args ?? {}) as { preview?: string; description?: string };
  return args.preview ?? args.description;
}

function ctaForKind(kind: string) {
  if (kind.includes("email") || kind.includes("inbox")) return "Read the drafts";
  if (kind.includes("outreach")) return "Review outreach";
  if (kind.includes("research")) return "See findings";
  if (kind.includes("writer")) return "Read the draft";
  if (kind.includes("code")) return "Review the change";
  if (kind.includes("meeting")) return "Open meeting";
  return "Open";
}

function destForKind(kind: string, taskId: string): string {
  if (kind.includes("inbox") || kind.includes("email") || kind.includes("writer") || kind.includes("outreach")) {
    return `/inbox?task=${taskId}`;
  }
  if (kind.includes("meeting")) return `/meetings`;
  if (kind.includes("code")) return `/history?task=${taskId}`;
  if (kind.includes("research")) return `/history?task=${taskId}`;
  if (kind.includes("crypto")) return `/history?task=${taskId}`;
  return `/history?task=${taskId}`;
}

export function OperationsBoard({ fallbackName }: Props) {
  const router = useRouter();
  const { tasks: needsApproval } = useTasks({
    status: "needs_approval",
    limit: 10,
  });
  const { tasks: recent } = useTasks({
    status: ["done", "running", "failed"],
    limit: 12,
  });

  const dismiss = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/reject`, { method: "POST" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ variant: "error", title: err.error ?? "Dismiss failed" });
      }
    } catch {
      toast({ variant: "error", title: "Network error" });
    }
  }, []);

  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [retried, setRetried] = useState<Set<string>>(new Set());
  const [bulkRetrying, setBulkRetrying] = useState(false);

  const retry = useCallback(async (taskId: string) => {
    setRetrying((s) => new Set(s).add(taskId));
    try {
      const res = await fetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "retry failed");
      setRetried((s) => new Set(s).add(taskId));
      toast({ variant: "success", title: "Re-queued" });
    } catch (err) {
      toast({
        variant: "error",
        title: "Retry failed",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRetrying((s) => {
        const next = new Set(s);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  const retryableFailedIds = useMemo(
    () =>
      (recent ?? [])
        .filter(
          (t) =>
            t.status === "failed" &&
            RETRYABLE_KINDS.has(t.kind) &&
            !retried.has(t.id),
        )
        .map((t) => t.id),
    [recent, retried],
  );

  const retryAll = useCallback(async () => {
    if (retryableFailedIds.length === 0) return;
    setBulkRetrying(true);
    try {
      const res = await fetch("/api/tasks/bulk-retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: retryableFailedIds }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        retried?: number;
        skipped?: Array<{ reason: string }>;
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "bulk retry failed");
      setRetried((s) => {
        const next = new Set(s);
        for (const id of retryableFailedIds) next.add(id);
        return next;
      });
      const count = body.retried ?? 0;
      toast({
        variant: "success",
        title: count === 1 ? "Re-queued 1 task" : `Re-queued ${count} tasks`,
        body: body.skipped && body.skipped.length > 0
          ? `${body.skipped.length} skipped`
          : undefined,
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Bulk retry failed",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBulkRetrying(false);
    }
  }, [retryableFailedIds]);

  const pendingCount = needsApproval?.length ?? 0;
  const runningCount = useMemo(
    () => (recent ?? []).filter((t) => t.status === "running").length,
    [recent],
  );
  const doneToday = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return (recent ?? []).filter(
      (t) =>
        t.status === "done" &&
        t.completed_at &&
        new Date(t.completed_at).getTime() > cutoff,
    ).length;
  }, [recent]);
  const failed = useMemo(
    () => (recent ?? []).filter((t) => t.status === "failed").length,
    [recent],
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 380px",
        gap: 24,
        padding: "24px 32px 40px",
        alignItems: "start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          <MetricCard
            label="Waiting on you"
            value={pendingCount}
            delta={pendingCount ? "need a yes" : "nothing open"}
            tone={pendingCount ? "alert" : "default"}
          />
          <MetricCard
            label="Running"
            value={runningCount}
            delta={runningCount ? "I'm on it" : "idle"}
          />
          <MetricCard
            label="Done · 24h"
            value={doneToday}
            delta={doneToday ? "handled" : "nothing yet"}
            tone="positive"
          />
          <MetricCard
            label="Failed"
            value={failed}
            delta={failed ? "check the log" : "all green"}
            tone={failed ? "alert" : "default"}
          />
        </div>

        {retryableFailedIds.length > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: -8,
            }}
          >
            <button
              type="button"
              onClick={retryAll}
              disabled={bulkRetrying}
              title="Re-queue every retryable failed task"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.9px",
                padding: "5px 12px",
                background: "transparent",
                color: "var(--magenta)",
                border: "1px solid var(--magenta-soft)",
                borderRadius: 6,
                cursor: bulkRetrying ? "wait" : "pointer",
                opacity: bulkRetrying ? 0.5 : 1,
                textTransform: "uppercase",
              }}
            >
              {bulkRetrying
                ? "Re-queueing…"
                : `Retry all · ${retryableFailedIds.length}`}
            </button>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionHeading
            meta={pendingCount ? `${pendingCount} · REVIEW → APPROVE` : undefined}
          >
            Show me
          </SectionHeading>
          {pendingCount === 0 && (
            <EmptyState
              title={`Nothing waiting${fallbackName ? `, ${fallbackName}` : ""}.`}
              body="When I draft something or stage a decision for you, it lands here."
            />
          )}
          {(needsApproval ?? []).map((t, i) => (
            <ApprovalCard
              key={t.id}
              n={i + 1}
              head={taskTitle(t)}
              body={taskBody(t)}
              cta={ctaForKind(t.kind)}
              onCta={() => router.push(destForKind(t.kind, t.id))}
              onDismiss={() => dismiss(t.id)}
            />
          ))}
        </div>
      </div>

      <Card padding="18px 20px 22px">
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "1.6px",
            textTransform: "uppercase",
            marginBottom: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Activity</span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--indigo)",
              animation: "jv-pulse 1.6s ease-in-out infinite",
            }}
          />
        </div>
        {(recent ?? []).length === 0 && (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-4)",
              padding: "20px 0",
              textAlign: "center",
            }}
          >
            Quiet so far.
          </div>
        )}
        {(recent ?? []).map((t) => (
          <div
            key={t.id}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr auto",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid var(--rule-soft)",
              alignItems: "baseline",
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-4)",
                letterSpacing: "0.4px",
              }}
            >
              {timeAgo(t.completed_at ?? t.created_at)}
            </div>
            <div
              style={{
                fontFamily: "var(--sans)",
                fontSize: 13,
                color: t.status === "failed" ? "var(--magenta)" : "var(--ink-2)",
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {taskTitle(t)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {t.status === "failed" && RETRYABLE_KINDS.has(t.kind) && !retried.has(t.id) && (
                <button
                  type="button"
                  onClick={() => retry(t.id)}
                  disabled={retrying.has(t.id)}
                  title="Reset to queued and re-run"
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    letterSpacing: "0.8px",
                    padding: "3px 8px",
                    background: "transparent",
                    color: "var(--ink-3)",
                    border: "1px solid var(--rule)",
                    borderRadius: 6,
                    cursor: retrying.has(t.id) ? "wait" : "pointer",
                    opacity: retrying.has(t.id) ? 0.5 : 1,
                  }}
                >
                  {retrying.has(t.id) ? "…" : "RETRY"}
                </button>
              )}
              {retried.has(t.id) && (
                <Chip color="var(--indigo)" border="var(--indigo-soft)" size={9.5}>
                  QUEUED
                </Chip>
              )}
              {!retried.has(t.id) && (
                <Chip
                  color={
                    t.status === "done"
                      ? "var(--indigo)"
                      : t.status === "running"
                      ? "var(--violet)"
                      : "var(--magenta)"
                  }
                  border={
                    t.status === "done"
                      ? "var(--indigo-soft)"
                      : t.status === "running"
                      ? "var(--violet-soft)"
                      : "var(--magenta-soft)"
                  }
                  size={9.5}
                >
                  {t.status}
                </Chip>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
