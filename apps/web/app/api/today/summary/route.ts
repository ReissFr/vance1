// Single round-trip for the /today dashboard. Pulls today's calendar,
// unread-email count, revenue today, upcoming subscription renewals, and
// counts of pending tasks / approvals. Every section degrades silently:
// if Stripe isn't connected, revenue is null — the card just hides itself.

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { getPaymentProvider, type RevenueSummary } from "@jarvis/integrations";

export const runtime = "nodejs";

type CalendarEvent = {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
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

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, google_access_token, timezone")
    .eq("id", user.id)
    .single();

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [calendar, revenue, subscriptions, counts, recentBriefing, activity, commitments, scheduled] = await Promise.all([
    pullCalendar(profile?.google_access_token ?? null, startOfDay, endOfDay),
    pullRevenue(admin, user.id),
    pullUpcomingSubscriptions(admin, user.id, inAWeek),
    pullCounts(admin, user.id),
    pullLatestBriefing(admin, user.id),
    pullActivity(admin, user.id, startOfDay),
    pullDueCommitments(admin, user.id, endOfDay),
    pullScheduledTasks(admin, user.id, endOfDay),
  ]);

  return NextResponse.json({
    ok: true,
    display_name: profile?.display_name ?? null,
    timezone: profile?.timezone ?? null,
    calendar,
    revenue,
    subscriptions,
    counts,
    briefing: recentBriefing,
    activity,
    commitments,
    scheduled,
  });
}

async function pullCalendar(
  accessToken: string | null,
  from: Date,
  to: Date,
): Promise<CalendarEvent[] | null> {
  if (!accessToken) return null;
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth });
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 30,
    });
    return (res.data.items ?? []).map((e) => ({
      id: e.id ?? "",
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      location: e.location ?? null,
    }));
  } catch {
    return null;
  }
}

async function pullRevenue(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
): Promise<{ today: RevenueSummary[]; mtd: RevenueSummary[] } | null> {
  try {
    const provider = await getPaymentProvider(admin, userId);
    const [today, mtd] = await Promise.all([
      provider.listRevenue("today"),
      provider.listRevenue("mtd"),
    ]);
    return { today, mtd };
  } catch {
    return null;
  }
}

async function pullUpcomingSubscriptions(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  until: Date,
): Promise<SubscriptionRenewal[]> {
  const { data } = await admin
    .from("subscriptions")
    .select("id, service_name, amount, currency, next_renewal_date, cadence, status")
    .eq("user_id", userId)
    .in("status", ["active", "trial"])
    .not("next_renewal_date", "is", null)
    .lte("next_renewal_date", until.toISOString().slice(0, 10))
    .order("next_renewal_date", { ascending: true })
    .limit(15);

  return (data ?? []).map((s) => ({
    id: s.id as string,
    service_name: s.service_name as string,
    amount: (s.amount as number | null) ?? null,
    currency: (s.currency as string) ?? "GBP",
    next_renewal_date: s.next_renewal_date as string | null,
    cadence: s.cadence as string,
  }));
}

async function pullCounts(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
): Promise<{
  approvals: number;
  active: number;
  queued: number;
  armed_automations: number;
}> {
  const [approvals, active, queued, automations] = await Promise.all([
    admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "needs_approval"),
    admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["running"]),
    admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "queued"),
    admin
      .from("automations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("enabled", true),
  ]);
  return {
    approvals: approvals.count ?? 0,
    active: active.count ?? 0,
    queued: queued.count ?? 0,
    armed_automations: automations.count ?? 0,
  };
}

async function pullDueCommitments(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  endOfDay: Date,
): Promise<DueCommitment[]> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("commitments")
    .select("id, direction, other_party, commitment_text, deadline, status")
    .eq("user_id", userId)
    .eq("status", "open")
    .not("deadline", "is", null)
    .lte("deadline", endOfDay.toISOString())
    .order("deadline", { ascending: true })
    .limit(20);

  return (data ?? []).map((c) => ({
    id: c.id as string,
    direction: (c.direction as "inbound" | "outbound") ?? "outbound",
    other_party: (c.other_party as string) ?? "",
    commitment_text: (c.commitment_text as string) ?? "",
    deadline: (c.deadline as string | null) ?? null,
    overdue: Boolean(c.deadline && (c.deadline as string) < nowIso),
  }));
}

async function pullScheduledTasks(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  endOfDay: Date,
): Promise<ScheduledTask[]> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("tasks")
    .select("id, kind, args, scheduled_at")
    .eq("user_id", userId)
    .eq("status", "queued")
    .not("scheduled_at", "is", null)
    .gt("scheduled_at", nowIso)
    .lte("scheduled_at", endOfDay.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);

  return (data ?? []).map((t) => {
    const args = (t.args as { title?: string; body?: string; message?: string } | null) ?? null;
    const title = args?.title ?? args?.message ?? args?.body ?? String(t.kind ?? "Task");
    return {
      id: t.id as string,
      kind: (t.kind as string) ?? "task",
      title,
      scheduled_at: (t.scheduled_at as string) ?? "",
    };
  });
}

async function pullActivity(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  startOfDay: Date,
): Promise<ActivityItem[]> {
  const { data } = await admin
    .from("tasks")
    .select("id, kind, status, args, created_at, completed_at, cost_usd")
    .eq("user_id", userId)
    .in("status", ["done", "needs_approval", "failed"])
    .gte("created_at", startOfDay.toISOString())
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(30);

  return (data ?? []).map((t) => {
    const args = (t.args as { title?: string } | null) ?? null;
    const title = args?.title ?? String(t.kind ?? "Task");
    return {
      id: t.id as string,
      kind: (t.kind as string) ?? "task",
      status: (t.status as string) ?? "done",
      title,
      completed_at: (t.completed_at as string | null) ?? null,
      created_at: (t.created_at as string) ?? "",
      cost_usd: (t.cost_usd as number | null) ?? null,
    };
  });
}

async function pullLatestBriefing(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
): Promise<{ text: string; at: string } | null> {
  const { data } = await admin
    .from("tasks")
    .select("result, completed_at")
    .eq("user_id", userId)
    .eq("kind", "briefing")
    .eq("status", "done")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.result) return null;
  const text = typeof data.result === "string" ? data.result : String(data.result);
  return { text, at: (data.completed_at as string) ?? "" };
}
