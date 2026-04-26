"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NavRail } from "./NavRail";
import { CommandLine } from "./CommandLine";
import { LocationReporter } from "../LocationReporter";
import { supabaseBrowser } from "@/lib/supabase/client";

type Props = {
  children: ReactNode;
  showCommand?: boolean;
  badges?: Partial<Record<string, number>>;
  live?: Partial<Record<string, boolean>>;
};

function useTaskIndicators() {
  const [approvals, setApprovals] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState<number | undefined>(undefined);
  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const refetch = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const [approvalsRes, runningRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "needs_approval"),
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .in("status", ["queued", "running"]),
      ]);
      if (cancelled) return;
      setApprovals(approvalsRes.count ?? 0);
      setRunning(runningRes.count ?? 0);
    };

    const start = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      await refetch();
      channel = supabase
        .channel(`task-indicators:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
            filter: `user_id=eq.${user.id}`,
          },
          () => { void refetch(); },
        )
        .subscribe();
    };
    void start();
    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, []);
  return { approvals, running };
}

function useStaleCommitments() {
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const refetch = async () => {
      try {
        const res = await fetch("/api/commitments/stale", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled) setCount(data.count ?? 0);
      } catch {
        // soft-fail — badge is informational, not critical
      }
    };
    void refetch();
    const id = setInterval(refetch, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return count;
}

type MoneyWasteCounts = { breachedBudgets: number; staleSubs: number };

function useMoneyWaste(): MoneyWasteCounts {
  const [state, setState] = useState<MoneyWasteCounts>({ breachedBudgets: 0, staleSubs: 0 });
  useEffect(() => {
    let cancelled = false;
    const refetch = async () => {
      try {
        const [budgetRes, subsRes] = await Promise.all([
          fetch("/api/budgets", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { budgets: [] }))
            .catch(() => ({ budgets: [] })),
          fetch("/api/subscriptions", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { subscriptions: [] }))
            .catch(() => ({ subscriptions: [] })),
        ]);
        if (cancelled) return;
        const budgets = ((budgetRes as { budgets?: Array<{ active?: boolean; status?: { state?: string } | null }> })?.budgets ?? []);
        const breachedBudgets = budgets.filter(
          (b) => b.active !== false && b.status?.state === "breach",
        ).length;
        const subs = ((subsRes as {
          subscriptions?: Array<{
            status: string;
            cadence: string;
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
        }).length;
        setState({ breachedBudgets, staleSubs });
      } catch {
        // soft-fail
      }
    };
    void refetch();
    const id = setInterval(refetch, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return state;
}

function ModePill() {
  const [mode, setMode] = useState<"assistant" | "ceo" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/mode", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { mode?: string };
        if (!cancelled) setMode(data.mode === "ceo" ? "ceo" : "assistant");
      } catch {
        if (!cancelled) setMode("assistant");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode == null) return null;

  const next: "assistant" | "ceo" = mode === "ceo" ? "assistant" : "ceo";
  const isCeo = mode === "ceo";

  const swap = async () => {
    if (busy) return;
    setBusy(true);
    const prev = mode;
    setMode(next);
    try {
      const res = await fetch("/api/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) setMode(prev);
    } catch {
      setMode(prev);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void swap()}
      title={`Switch to ${next.toUpperCase()} mode`}
      style={{
        position: "fixed",
        top: 14,
        right: 14,
        zIndex: 40,
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${isCeo ? "#7affcb" : "var(--rule)"}`,
        background: isCeo ? "rgba(122,255,203,0.08)" : "var(--surface)",
        color: isCeo ? "#7affcb" : "var(--ink-2)",
        font: "600 10px/1 var(--mono)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {isCeo ? "● CEO" : "○ ASSIST"}
    </button>
  );
}

function usePinnedMemoryCount() {
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const refetch = async () => {
      try {
        const res = await fetch("/api/memory?pinned=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { memories?: Array<{ pinned?: boolean }> };
        if (cancelled) return;
        const n = (data.memories ?? []).filter((m) => m.pinned).length;
        setCount(n);
      } catch {
        // soft-fail
      }
    };
    void refetch();
    const id = setInterval(refetch, 180_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return count;
}

export function AppShell({ children, showCommand = true, badges, live }: Props) {
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { approvals: approvalsCount, running: runningCount } = useTaskIndicators();
  const staleCommitments = useStaleCommitments();
  const { breachedBudgets, staleSubs } = useMoneyWaste();
  const pinnedMemories = usePinnedMemoryCount();

  const mergedBadges = useMemo(() => {
    const next: Partial<Record<string, number>> = { ...(badges ?? {}) };
    if (approvalsCount != null && approvalsCount > 0 && next.ops == null) {
      next.ops = approvalsCount;
    }
    if (staleCommitments != null && staleCommitments > 0 && next.cmt == null) {
      next.cmt = staleCommitments;
    }
    if (breachedBudgets > 0 && next.bud == null) {
      next.bud = breachedBudgets;
    }
    if (staleSubs > 0 && next.mny == null) {
      next.mny = staleSubs;
    }
    if (pinnedMemories != null && pinnedMemories > 0 && next.mem == null) {
      next.mem = pinnedMemories;
    }
    return next;
  }, [badges, approvalsCount, staleCommitments, breachedBudgets, staleSubs, pinnedMemories]);

  const mergedLive = useMemo(() => {
    const next: Partial<Record<string, boolean>> = { ...(live ?? {}) };
    const hasActivity =
      (approvalsCount != null && approvalsCount > 0) ||
      (runningCount != null && runningCount > 0);
    if (hasActivity && next.ops == null) {
      next.ops = true;
    }
    return next;
  }, [live, approvalsCount, runningCount]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [isMobile]);

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        display: "flex",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--sans)",
      }}
    >
      {isMobile ? (
        <>
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Toggle navigation"
            style={{
              position: "fixed",
              top: 14,
              left: 14,
              zIndex: 40,
              width: 38,
              height: 38,
              borderRadius: 8,
              background: "var(--surface)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ width: 16, height: 1.5, background: "var(--ink-2)" }} />
              <span style={{ width: 16, height: 1.5, background: "var(--ink-2)" }} />
              <span style={{ width: 16, height: 1.5, background: "var(--ink-2)" }} />
            </div>
          </button>
          {drawerOpen && (
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                zIndex: 30,
              }}
            />
          )}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              zIndex: 35,
              transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
              transition: "transform 200ms var(--ease)",
            }}
          >
            <NavRail badges={mergedBadges} live={mergedLive} />
          </div>
        </>
      ) : (
        <NavRail badges={mergedBadges} live={mergedLive} />
      )}

      <LocationReporter />
      <ModePill />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          position: "relative",
          minHeight: "100vh",
          paddingTop: isMobile ? 58 : 0,
        }}
      >
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>{children}</div>
        {showCommand && (
          <div
            style={{
              padding: isMobile ? "10px 12px 14px" : "14px 32px 20px",
              borderTop: "1px solid var(--rule)",
              background: "var(--bg)",
              display: "flex",
              justifyContent: "center",
              position: "sticky",
              bottom: 0,
            }}
          >
            <CommandLine width={isMobile ? 360 : 560} />
          </div>
        )}
      </div>
    </div>
  );
}
