// Home dashboard feed. Returns everything JARVIS is doing RIGHT NOW so the
// home screen can lead with activity instead of a chat box. Five buckets:
//
//   active       — errands + long-running tasks currently driving toward a goal
//   armed        — enabled automations (cron, location, email_received, etc.)
//   upcoming     — tasks or automations that will fire in the next 24h
//   needs_you    — tasks/errands paused on the user (needs_approval) + automation_runs paused
//   recent       — things JARVIS did in the last 24h without being asked
//                  (automation_runs that completed, outbound notifications it sent)
//
// Kept in one round-trip so the home screen hydrates fast. All queries are
// RLS-scoped via supabaseServer() so the user only ever sees their own rows.
//
// Shape is deliberately flat and UI-friendly (title / subtitle / kind / id /
// timestamp) — the home component should not have to map domain types.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type FeedItem = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  at?: string;
  href?: string;
};

type FeedResponse = {
  active: FeedItem[];
  armed: FeedItem[];
  upcoming: FeedItem[];
  needsYou: FeedItem[];
  recent: FeedItem[];
};

function shorten(s: string | null | undefined, max = 90): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const last24hIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const [
    activeTasksRes,
    armedAutomationsRes,
    upcomingTasksRes,
    upcomingAutomationsRes,
    approvalsRes,
    awaitingRunsRes,
    recentRunsRes,
    recentOutboundRes,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, kind, status, prompt, args, created_at, started_at")
      .in("status", ["queued", "running"])
      .is("scheduled_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("automations")
      .select("id, title, trigger_kind, next_fire_at, last_fired_at, fire_count")
      .eq("enabled", true)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("tasks")
      .select("id, kind, prompt, args, scheduled_at")
      .eq("status", "queued")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", in24h)
      .order("scheduled_at", { ascending: true })
      .limit(10),
    supabase
      .from("automations")
      .select("id, title, trigger_kind, next_fire_at")
      .eq("enabled", true)
      .eq("trigger_kind", "cron")
      .not("next_fire_at", "is", null)
      .gte("next_fire_at", nowIso)
      .lte("next_fire_at", in24h)
      .order("next_fire_at", { ascending: true })
      .limit(10),
    supabase
      .from("tasks")
      .select("id, kind, prompt, args, needs_approval_at, created_at")
      .eq("status", "needs_approval")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("automation_runs")
      .select("id, automation_id, status, started_at")
      .eq("status", "awaiting_approval")
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("automation_runs")
      .select("id, automation_id, status, started_at, completed_at")
      .eq("status", "done")
      .gte("completed_at", last24hIso)
      .order("completed_at", { ascending: false })
      .limit(10),
    supabase
      .from("notifications")
      .select("id, channel, body, status, created_at, task_id")
      .in("status", ["sent", "delivered", "completed"])
      .gte("created_at", last24hIso)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const active: FeedItem[] = (activeTasksRes.data ?? []).map((t) => {
    const args = (t.args ?? {}) as { title?: string; objective?: string; summary?: string };
    const title =
      args.title ??
      args.objective ??
      args.summary ??
      t.prompt ??
      t.kind;
    return {
      id: t.id as string,
      kind: `task:${t.kind}`,
      title: shorten(title) ?? t.kind,
      subtitle: t.status === "running" ? "Running" : "Queued",
      at: (t.started_at as string) ?? (t.created_at as string),
      href: "/operations",
    };
  });

  const armed: FeedItem[] = (armedAutomationsRes.data ?? []).map((a) => ({
    id: a.id as string,
    kind: `automation:${a.trigger_kind}`,
    title: a.title as string,
    subtitle:
      a.trigger_kind === "cron" && a.next_fire_at
        ? `Next: ${new Date(a.next_fire_at as string).toLocaleString()}`
        : `Trigger: ${formatTrigger(a.trigger_kind as string)}`,
    at: (a.last_fired_at as string | null) ?? undefined,
    href: "/features",
  }));

  const upcomingTasks: FeedItem[] = (upcomingTasksRes.data ?? []).map((t) => {
    const args = (t.args ?? {}) as { title?: string; summary?: string };
    return {
      id: t.id as string,
      kind: `scheduled:${t.kind}`,
      title: shorten(args.title ?? args.summary ?? t.prompt ?? t.kind) ?? t.kind,
      subtitle: `At ${new Date(t.scheduled_at as string).toLocaleString()}`,
      at: t.scheduled_at as string,
      href: "/operations",
    };
  });
  const upcomingAutomations: FeedItem[] = (upcomingAutomationsRes.data ?? []).map((a) => ({
    id: `auto-${a.id}`,
    kind: "scheduled:automation",
    title: a.title as string,
    subtitle: `At ${new Date(a.next_fire_at as string).toLocaleString()}`,
    at: a.next_fire_at as string,
    href: "/features",
  }));
  const upcoming: FeedItem[] = [...upcomingTasks, ...upcomingAutomations]
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
    .slice(0, 10);

  const approvalItems: FeedItem[] = (approvalsRes.data ?? []).map((t) => {
    const args = (t.args ?? {}) as { title?: string; summary?: string; preview?: string };
    return {
      id: t.id as string,
      kind: `approval:${t.kind}`,
      title: shorten(args.title ?? args.summary ?? t.prompt ?? "Needs approval") ?? "Needs approval",
      subtitle: shorten(args.preview),
      at: (t.needs_approval_at as string) ?? (t.created_at as string),
      href: "/operations",
    };
  });
  const awaitingItems: FeedItem[] = (awaitingRunsRes.data ?? []).map((r) => ({
    id: r.id as string,
    kind: "approval:automation",
    title: "Automation waiting on your reply",
    at: r.started_at as string,
    href: "/features",
  }));
  const needsYou: FeedItem[] = [...approvalItems, ...awaitingItems]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 10);

  const recentRuns: FeedItem[] = (recentRunsRes.data ?? []).map((r) => ({
    id: r.id as string,
    kind: "run:automation",
    title: "Automation fired",
    subtitle: r.completed_at ? new Date(r.completed_at as string).toLocaleTimeString() : undefined,
    at: (r.completed_at as string | null) ?? (r.started_at as string),
    href: "/features",
  }));
  const recentOutbound: FeedItem[] = (recentOutboundRes.data ?? []).map((n) => ({
    id: n.id as string,
    kind: `proactive:${n.channel}`,
    title: n.channel === "call" ? "Called you" : "Messaged you",
    subtitle: shorten(n.body as string | null),
    at: n.created_at as string,
  }));
  const recent: FeedItem[] = [...recentRuns, ...recentOutbound]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 10);

  const body: FeedResponse = { active, armed, upcoming, needsYou, recent };
  return NextResponse.json(body);
}

function formatTrigger(kind: string): string {
  switch (kind) {
    case "location_arrived": return "when you arrive somewhere";
    case "location_left": return "when you leave somewhere";
    case "email_received": return "on incoming email";
    case "bank_txn": return "on bank transaction";
    case "payment_received": return "on payment received";
    case "calendar_event": return "before a calendar event";
    case "cron": return "on schedule";
    default: return kind;
  }
}
