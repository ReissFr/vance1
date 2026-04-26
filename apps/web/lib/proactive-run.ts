// Opportunistic "JARVIS initiates" loop. Runs every N minutes via cron; for
// each user with proactive_enabled, gathers fresh signals (new emails,
// upcoming calendar, task status changes, recent memories), asks Haiku if
// there's ONE thing worth interrupting the user about right now, and if so
// sends a WhatsApp + writes to a conversation.
//
// Rate limits, quiet hours, and topic deduping keep this from becoming spam.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getEmailProvider, type EmailSummary } from "@jarvis/integrations";
import { recentMemories } from "@jarvis/agent";
import { dispatchNotification } from "./notify";
import { buildEventPrep, type EventPrep } from "./calendar-prep";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 400;

const MIN_GAP_MINUTES = 75;
const DAILY_CAP = 4;
// Defaults used when the user has no per-profile override.
const DEFAULT_QUIET_START_HOUR = 22;
const DEFAULT_QUIET_END_HOUR = 8;
const DEFAULT_TZ = "Europe/London";

const CALENDAR_LOOKAHEAD_MS = 3 * 60 * 60 * 1000;
const EMAIL_LOOKAHEAD = "newer_than:1h is:unread";
const MAX_EMAILS = 5;
const MAX_CAL_EVENTS = 6;

// Events this close to starting trigger a prep fetch (attendee commitments +
// recent context) so the judge can pre-meeting-ping with real substance.
const PREP_WINDOW_MIN = 5;
const PREP_WINDOW_MAX = 25;

// Debug-mode windows: called via runProactiveTickForUser with { force: true }
// from a one-off curl, to prove the pipeline works end-to-end even when the
// real-time windows would be quiet. Also bypasses quiet-hours + rate-limit.
const DEBUG_CALENDAR_LOOKAHEAD_MS = 12 * 60 * 60 * 1000;
const DEBUG_EMAIL_LOOKAHEAD = "newer_than:1d";

type ProactiveState = {
  user_id: string;
  last_ping_at: string | null;
  last_tick_at: string | null;
  day_key: string;
  pings_today: number;
  last_seen_email_id: string | null;
  last_ping_topic: string | null;
};

type SubscriptionAlert =
  | { kind: "trial_ending"; service: string; amount: number | null; currency: string; endsInDays: number; renewsAt: string }
  | { kind: "new_sub"; service: string; amount: number | null; currency: string; cadence: string; firstSeenAt: string };

type DueCommitment = {
  id: string;
  direction: "outbound" | "inbound";
  otherParty: string;
  commitmentText: string;
  deadline: string;
  // Positive = already overdue by N days, negative = N days until due.
  overdueDays: number;
};

type UpcomingEvent = {
  id: string;
  summary: string;
  start: string | null;
  minutesAway: number | null;
  attendees: string[];
  prep: EventPrep | null;
};

type StalledApproval = {
  id: string;
  kind: string;
  prompt: string;
  ageHours: number;
};

type Signals = {
  newEmails: EmailSummary[];
  upcomingCalendar: UpcomingEvent[];
  runningTasks: { id: string; kind: string; prompt: string; status: string; updatedAt: string }[];
  overdueLoops: string[];
  memories: string[];
  subscriptionAlerts: SubscriptionAlert[];
  dueCommitments: DueCommitment[];
  stalledApprovals: StalledApproval[];
  missedHabits: string[];
};

type Decision = {
  ping: boolean;
  message?: string;
  topic?: string;
  reason?: string;
  commitmentIds?: string[];
};

export async function runProactiveTickForUser(
  admin: SupabaseClient,
  anthropic: Anthropic,
  profile: {
    id: string;
    mobile_e164: string | null;
    google_access_token: string | null;
    display_name: string | null;
    timezone?: string | null;
    quiet_start_hour?: number | null;
    quiet_end_hour?: number | null;
  },
  opts?: { force?: boolean },
): Promise<{ pinged: boolean; reason: string; topic?: string }> {
  if (!profile.mobile_e164) {
    return { pinged: false, reason: "no mobile number" };
  }

  const state = await loadOrInitState(admin, profile.id);
  const now = new Date();
  const force = opts?.force === true;

  if (!force && !passesQuietHours(now, profile.timezone ?? null, profile.quiet_start_hour ?? null, profile.quiet_end_hour ?? null)) {
    await touchTick(admin, profile.id);
    return { pinged: false, reason: "quiet hours" };
  }

  if (!force && !passesRateLimit(state, now)) {
    await touchTick(admin, profile.id);
    return { pinged: false, reason: "rate limited" };
  }

  const signals = await gatherSignals(admin, profile, state, force);
  if (!force && isEmpty(signals)) {
    await touchTick(admin, profile.id);
    return { pinged: false, reason: "no signals" };
  }

  const decision = await judge(anthropic, profile.display_name ?? "the user", signals, state.last_ping_topic);

  if (!decision.ping || !decision.message) {
    await touchTick(admin, profile.id, advanceCursors(signals));
    return { pinged: false, reason: decision.reason ?? "judge said skip" };
  }

  await sendProactivePing(admin, profile.id, profile.mobile_e164, decision.message);

  await persistPing(admin, profile.id, state, now, decision.topic ?? null, advanceCursors(signals));

  // Mark any commitments the judge said it was pinging about — and sanity-
  // check against the ids we actually showed it, to stop model hallucinations
  // from poisoning random rows. Include both dueCommitments and any prep
  // commitments surfaced via the calendar section.
  const validIds = new Set<string>();
  for (const c of signals.dueCommitments) validIds.add(c.id);
  for (const e of signals.upcomingCalendar) {
    if (e.prep) for (const c of e.prep.commitments) validIds.add(c.id);
  }
  const nudgedIds = (decision.commitmentIds ?? []).filter((id) => validIds.has(id));
  if (nudgedIds.length > 0) {
    await admin
      .from("commitments")
      .update({ last_nudged_at: now.toISOString() })
      .eq("user_id", profile.id)
      .in("id", nudgedIds);
  }

  return { pinged: true, reason: "sent", topic: decision.topic };
}

async function loadOrInitState(admin: SupabaseClient, userId: string): Promise<ProactiveState> {
  const { data } = await admin
    .from("proactive_state")
    .select("user_id, last_ping_at, last_tick_at, day_key, pings_today, last_seen_email_id, last_ping_topic")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as ProactiveState;
  const today = new Date().toISOString().slice(0, 10);
  const initial: ProactiveState = {
    user_id: userId,
    last_ping_at: null,
    last_tick_at: null,
    day_key: today,
    pings_today: 0,
    last_seen_email_id: null,
    last_ping_topic: null,
  };
  await admin.from("proactive_state").upsert(initial, { onConflict: "user_id" });
  return initial;
}

function passesQuietHours(
  now: Date,
  tz: string | null,
  startHour: number | null,
  endHour: number | null,
): boolean {
  const zone = tz && tz.trim() ? tz.trim() : DEFAULT_TZ;
  const start = clampHour(startHour, DEFAULT_QUIET_START_HOUR);
  const end = clampHour(endHour, DEFAULT_QUIET_END_HOUR);
  // Equal start/end => effectively "no quiet hours" (never blocks).
  if (start === end) return true;
  const hour = parseInt(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: zone }).format(now),
    10,
  );
  if (Number.isNaN(hour)) return true;
  if (start >= end) {
    return !(hour >= start || hour < end);
  }
  return !(hour >= start && hour < end);
}

function clampHour(v: number | null | undefined, fallback: number): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  if (n < 0 || n > 23) return fallback;
  return n;
}

function passesRateLimit(state: ProactiveState, now: Date): boolean {
  const todayKey = now.toISOString().slice(0, 10);
  // If the day has rolled over, pings_today gets effectively reset when we
  // write state back. For this check, count a rolled-over day as 0 pings.
  const pingsToday = state.day_key === todayKey ? state.pings_today : 0;
  if (pingsToday >= DAILY_CAP) return false;

  if (state.last_ping_at) {
    const gapMs = now.getTime() - new Date(state.last_ping_at).getTime();
    if (gapMs < MIN_GAP_MINUTES * 60_000) return false;
  }
  return true;
}

async function gatherSignals(
  admin: SupabaseClient,
  profile: { id: string; google_access_token: string | null },
  state: ProactiveState,
  force = false,
): Promise<Signals> {
  const [emails, calendar, tasks, memories, subAlerts, dueCommitments, stalledApprovals, missedHabits] = await Promise.all([
    pullNewEmails(admin, profile.id, state.last_seen_email_id, force),
    pullUpcomingCalendar(admin, profile.id, profile.google_access_token, force),
    pullRecentTaskChanges(admin, profile.id, state.last_tick_at),
    pullRecentMemories(admin, profile.id),
    pullSubscriptionAlerts(admin, profile.id, state.last_tick_at),
    pullDueCommitments(admin, profile.id, force),
    pullStalledApprovals(admin, profile.id, force),
    pullMissedHabits(admin, profile.id, force),
  ]);
  return {
    newEmails: emails,
    upcomingCalendar: calendar,
    runningTasks: tasks,
    overdueLoops: [],
    memories,
    subscriptionAlerts: subAlerts,
    dueCommitments,
    stalledApprovals,
    missedHabits,
  };
}

// Names of the user's daily habits that are still unticked today. Only fires
// in the evening window — before that a "you haven't gymmed yet" at noon is
// just noise.
async function pullMissedHabits(
  admin: SupabaseClient,
  userId: string,
  force = false,
): Promise<string[]> {
  try {
    const hour = new Date().getUTCHours();
    // 18–22 UTC is roughly 19–23 UK local depending on BST — close enough
    // that the user hasn't gone to bed but it's late enough that unchecked
    // daily habits are probably slipping. Force drops the gate.
    if (!force && (hour < 18 || hour > 22)) return [];

    const { data: habits } = await admin
      .from("habits")
      .select("id, name, cadence")
      .eq("user_id", userId)
      .eq("cadence", "daily")
      .is("archived_at", null);
    const dailyHabits = (habits ?? []) as { id: string; name: string }[];
    if (dailyHabits.length === 0) return [];

    const today = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const day = d.getDate();
      return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
    })();

    const { data: todayLogs } = await admin
      .from("habit_logs")
      .select("habit_id")
      .eq("user_id", userId)
      .eq("log_date", today);
    const done = new Set(
      ((todayLogs ?? []) as { habit_id: string }[]).map((r) => r.habit_id),
    );
    return dailyHabits.filter((h) => !done.has(h.id)).map((h) => h.name);
  } catch {
    return [];
  }
}

async function pullStalledApprovals(
  admin: SupabaseClient,
  userId: string,
  force = false,
): Promise<StalledApproval[]> {
  try {
    const now = Date.now();
    // Force: anything in needs_approval; normal: only rows idle for 24h+ so
    // we don't nag on drafts the user literally just created.
    const cutoffIso = new Date(now - (force ? 0 : 24 * 60 * 60_000)).toISOString();
    const { data } = await admin
      .from("tasks")
      .select("id, kind, prompt, updated_at")
      .eq("user_id", userId)
      .eq("status", "needs_approval")
      .lte("updated_at", cutoffIso)
      .order("updated_at", { ascending: true })
      .limit(5);
    return (data ?? []).map((t) => {
      const ageMs = now - new Date(t.updated_at as string).getTime();
      return {
        id: t.id as string,
        kind: t.kind as string,
        prompt: ((t.prompt as string) ?? "").slice(0, 140),
        ageHours: Math.round(ageMs / (60 * 60_000)),
      };
    });
  } catch {
    return [];
  }
}

async function pullDueCommitments(
  admin: SupabaseClient,
  userId: string,
  force = false,
): Promise<DueCommitment[]> {
  try {
    const now = new Date();
    // "Coming due" = within next 12h or already overdue.
    const soon = new Date(now.getTime() + 12 * 60 * 60_000).toISOString();
    // Don't re-nudge anything we nudged in the last 2 days (unless force=true).
    const twoDaysAgoIso = new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString();

    let q = admin
      .from("commitments")
      .select("id, direction, other_party, commitment_text, deadline, last_nudged_at")
      .eq("user_id", userId)
      .eq("status", "open")
      .not("deadline", "is", null)
      .lte("deadline", soon)
      .order("deadline", { ascending: true })
      .limit(5);
    if (!force) {
      q = q.or(`last_nudged_at.is.null,last_nudged_at.lt.${twoDaysAgoIso}`);
    }
    const { data } = await q;

    return (data ?? []).map((r) => {
      const deadline = r.deadline as string;
      const overdueMs = now.getTime() - new Date(deadline).getTime();
      return {
        id: r.id as string,
        direction: r.direction as "outbound" | "inbound",
        otherParty: r.other_party as string,
        commitmentText: r.commitment_text as string,
        deadline,
        overdueDays: Math.round(overdueMs / (24 * 60 * 60_000)),
      };
    });
  } catch {
    return [];
  }
}

async function pullSubscriptionAlerts(
  admin: SupabaseClient,
  userId: string,
  lastTickAt: string | null,
): Promise<SubscriptionAlert[]> {
  try {
    const alerts: SubscriptionAlert[] = [];
    const now = new Date();
    const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const nowDate = now.toISOString().slice(0, 10);

    // Trials ending in next 3 days.
    const { data: trials } = await admin
      .from("subscriptions")
      .select("service_name, amount, currency, next_renewal_date")
      .eq("user_id", userId)
      .eq("status", "trial")
      .not("next_renewal_date", "is", null)
      .gte("next_renewal_date", nowDate)
      .lte("next_renewal_date", horizon)
      .limit(5);

    for (const t of trials ?? []) {
      const renewsAt = t.next_renewal_date as string;
      const endsInDays = Math.max(
        0,
        Math.round((new Date(renewsAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );
      alerts.push({
        kind: "trial_ending",
        service: t.service_name as string,
        amount: t.amount == null ? null : Number(t.amount),
        currency: (t.currency as string) || "GBP",
        endsInDays,
        renewsAt,
      });
    }

    // New subs detected since the last tick — if this is the user's first tick
    // we'd spam them, so require lastTickAt.
    if (lastTickAt) {
      const { data: fresh } = await admin
        .from("subscriptions")
        .select("service_name, amount, currency, cadence, first_seen_at, user_confirmed")
        .eq("user_id", userId)
        .gt("first_seen_at", lastTickAt)
        .in("status", ["active", "trial"])
        .limit(5);
      for (const s of fresh ?? []) {
        // Skip ones the user manually confirmed — they already know.
        if (s.user_confirmed) continue;
        alerts.push({
          kind: "new_sub",
          service: s.service_name as string,
          amount: s.amount == null ? null : Number(s.amount),
          currency: (s.currency as string) || "GBP",
          cadence: (s.cadence as string) || "unknown",
          firstSeenAt: s.first_seen_at as string,
        });
      }
    }

    return alerts;
  } catch {
    return [];
  }
}

async function pullNewEmails(
  admin: SupabaseClient,
  userId: string,
  lastSeenId: string | null,
  force = false,
): Promise<EmailSummary[]> {
  try {
    const provider = await getEmailProvider(admin, userId);
    const query = force ? DEBUG_EMAIL_LOOKAHEAD : EMAIL_LOOKAHEAD;
    const list = await provider.list({ query, max: MAX_EMAILS });
    if (force || !lastSeenId) return list;
    const idx = list.findIndex((e) => e.id === lastSeenId);
    return idx === -1 ? list : list.slice(0, idx);
  } catch {
    return [];
  }
}

async function pullUpcomingCalendar(
  admin: SupabaseClient,
  userId: string,
  accessToken: string | null,
  force = false,
): Promise<UpcomingEvent[]> {
  if (!accessToken) return [];
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth });
    const now = new Date();
    const lookahead = force ? DEBUG_CALENDAR_LOOKAHEAD_MS : CALENDAR_LOOKAHEAD_MS;
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + lookahead).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: MAX_CAL_EVENTS,
    });
    const events: UpcomingEvent[] = (res.data.items ?? []).map((e) => {
      const start = e.start?.dateTime ?? e.start?.date ?? null;
      const minutesAway = start
        ? Math.round((new Date(start).getTime() - now.getTime()) / 60_000)
        : null;
      const attendees = (e.attendees ?? [])
        .map((a) => a.email)
        .filter((x): x is string => Boolean(x));
      return {
        id: e.id ?? "",
        summary: e.summary ?? "(no title)",
        start,
        minutesAway,
        attendees,
        prep: null,
      };
    });

    // Pre-meeting prep: for events within the 5–25 min window, attach recall
    // context + open attendee commitments so the judge can ping with real
    // substance ("heads-up — 3pm with Ana, you still owe her the pricing deck").
    // Force mode widens to any event in the debug lookahead window.
    const toPrep = events.filter((e) => {
      if (!e.id) return false;
      if (force) return e.attendees.length > 0;
      if (e.minutesAway == null) return false;
      return (
        e.minutesAway >= PREP_WINDOW_MIN &&
        e.minutesAway <= PREP_WINDOW_MAX &&
        e.attendees.length > 0
      );
    });
    await Promise.all(
      toPrep.map(async (e) => {
        try {
          e.prep = await buildEventPrep(admin, userId, {
            id: e.id,
            summary: e.summary,
            attendees: e.attendees,
          });
        } catch {
          e.prep = null;
        }
      }),
    );

    return events;
  } catch {
    return [];
  }
}

async function pullRecentTaskChanges(
  admin: SupabaseClient,
  userId: string,
  lastTickAt: string | null,
): Promise<Signals["runningTasks"]> {
  try {
    const since = lastTickAt ?? new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await admin
      .from("tasks")
      .select("id, kind, prompt, status, updated_at")
      .eq("user_id", userId)
      .gte("updated_at", since)
      .in("status", ["running", "needs_approval", "completed", "failed"])
      .order("updated_at", { ascending: false })
      .limit(5);
    return (data ?? []).map((t) => ({
      id: t.id as string,
      kind: t.kind as string,
      prompt: (t.prompt as string) ?? "",
      status: t.status as string,
      updatedAt: t.updated_at as string,
    }));
  } catch {
    return [];
  }
}

async function pullRecentMemories(admin: SupabaseClient, userId: string): Promise<string[]> {
  try {
    const mems = await recentMemories(admin, userId, 8);
    return mems.map((m) => `[${m.kind}] ${m.content}`);
  } catch {
    return [];
  }
}

function isEmpty(s: Signals): boolean {
  return (
    s.newEmails.length === 0 &&
    s.upcomingCalendar.length === 0 &&
    s.runningTasks.length === 0 &&
    s.overdueLoops.length === 0 &&
    s.subscriptionAlerts.length === 0 &&
    s.dueCommitments.length === 0 &&
    s.stalledApprovals.length === 0 &&
    s.missedHabits.length === 0
  );
}

function buildJudgePrompt(
  userName: string,
  signals: Signals,
  lastPingTopic: string | null,
): string {
  const parts: string[] = [];
  parts.push(`USER: ${userName}`);
  if (signals.memories.length > 0) {
    parts.push(`\nMEMORIES (what JARVIS knows about them):\n${signals.memories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`);
  }
  if (signals.newEmails.length > 0) {
    parts.push(
      `\nNEW EMAILS (last hour, unread):\n${signals.newEmails
        .map(
          (e, i) =>
            `${i + 1}. from "${e.from}" — subject: "${e.subject}"${e.snippet ? ` — ${e.snippet.slice(0, 160)}` : ""}`,
        )
        .join("\n")}`,
    );
  }
  if (signals.upcomingCalendar.length > 0) {
    const lines: string[] = [];
    signals.upcomingCalendar.forEach((e, i) => {
      const when = e.minutesAway !== null ? `${e.minutesAway}m` : "unknown";
      lines.push(`${i + 1}. "${e.summary}" in ${when}${e.start ? ` (${e.start})` : ""}`);
      if (e.prep) {
        if (e.prep.commitments.length > 0) {
          for (const c of e.prep.commitments) {
            const dir = c.direction === "outbound" ? "USER OWES" : "OTHER OWES USER";
            const due = c.deadline ? ` (deadline ${c.deadline})` : "";
            lines.push(
              `     · PREP [${dir}] [id=${c.id}] "${c.commitment_text}" to/from ${c.other_party}${due}`,
            );
          }
        }
        if (e.prep.related.length > 0) {
          for (const r of e.prep.related.slice(0, 3)) {
            lines.push(
              `     · PREP [${r.source}] ${r.title ?? ""} — ${r.snippet.slice(0, 160)}`.trim(),
            );
          }
        }
      }
    });
    parts.push(`\nCALENDAR (next 3 hours):\n${lines.join("\n")}`);
  }
  if (signals.runningTasks.length > 0) {
    parts.push(
      `\nRECENT BACKGROUND TASKS (status changed since last check):\n${signals.runningTasks
        .map((t, i) => `${i + 1}. [${t.kind} / ${t.status}] ${t.prompt.slice(0, 140)}`)
        .join("\n")}`,
    );
  }
  if (signals.subscriptionAlerts.length > 0) {
    const lines = signals.subscriptionAlerts.map((a, i) => {
      if (a.kind === "trial_ending") {
        const amt = a.amount != null ? `${a.currency} ${a.amount}` : "?";
        return `${i + 1}. TRIAL ENDING — "${a.service}" converts to paid in ${a.endsInDays}d (on ${a.renewsAt}), ${amt}/cycle`;
      }
      const amt = a.amount != null ? `${a.currency} ${a.amount} ${a.cadence}` : `unknown amount`;
      return `${i + 1}. NEW SUB DETECTED — "${a.service}" (${amt}), first seen ${a.firstSeenAt}`;
    });
    parts.push(`\nSUBSCRIPTION ALERTS:\n${lines.join("\n")}`);
  }
  if (signals.dueCommitments.length > 0) {
    const lines = signals.dueCommitments.map((c, i) => {
      const when =
        c.overdueDays > 0
          ? `${c.overdueDays}d OVERDUE`
          : c.overdueDays === 0
          ? "DUE TODAY"
          : `due in ${-c.overdueDays}d`;
      const dir = c.direction === "outbound" ? "USER OWES" : "OTHER OWES USER";
      return `${i + 1}. [${dir}] [id=${c.id}] "${c.commitmentText}" to/from ${c.otherParty} — ${when} (deadline ${c.deadline})`;
    });
    parts.push(
      `\nCOMMITMENTS DUE / OVERDUE (if you ping about one or more of these, echo their [id=…] values in commitment_ids):\n${lines.join("\n")}`,
    );
  }
  if (signals.stalledApprovals.length > 0) {
    const lines = signals.stalledApprovals.map(
      (t, i) =>
        `${i + 1}. [${t.kind}] stuck in needs_approval for ${t.ageHours}h — "${t.prompt}"`,
    );
    parts.push(
      `\nSTALLED APPROVALS (agent drafts awaiting user OK for 24h+):\n${lines.join("\n")}\n(topic for dedupe should be "stalled <kind>" or "stalled <id first 8>" so we don't nudge same item repeatedly)`,
    );
  }
  if (signals.missedHabits.length > 0) {
    parts.push(
      `\nMISSED DAILY HABITS (user hasn't ticked these today; it's evening):\n${signals.missedHabits
        .map((h, i) => `${i + 1}. ${h}`)
        .join("\n")}\n(topic for dedupe should be "missed habits <date>" so we only nudge once per evening)`,
    );
  }
  if (lastPingTopic) {
    parts.push(
      `\nLAST PROACTIVE PING TOPIC (do NOT ping again on the same topic): ${lastPingTopic}`,
    );
  }
  return parts.join("\n");
}

const JUDGE_SYSTEM = `You are JARVIS's proactive judge. Your ONLY job is to decide whether — given the signals — to interrupt the user with a WhatsApp RIGHT NOW.

You should ping ONLY for things a competent chief-of-staff PA would interrupt for:
- A calendar event in ~15–30min where you have REAL prep content to offer (an open commitment with the attendees, a recent email thread the user should recall before they sit down). A generic "meeting soon" is noise — only ping if the PREP bullets give you specific substance.
- An email genuinely needing their attention within hours (VIP sender, time-sensitive ask, bank/security alert)
- A background task that just completed / needs approval / is stuck
- A draft that's been sitting in "needs_approval" for 24h+ (drafts rot; one gentle reminder is fair)
- A commitment the USER made that's due today or overdue (nudge them to follow through — "you told Ana you'd send pricing Friday, still on?"); or one someone OWES them that's now overdue (nudge them to chase)
- A trial subscription about to convert to paid within 2–3 days (so they can cancel if unwanted)
- A newly-detected subscription the user might have forgotten signing up for (ask if they want to keep it)
- Missed daily habits in the evening window — ONE gentle nudge per evening if the user still has unticked daily habits and it's late enough that they're about to drop them. Warm, not nagging. ("still time to hit X and Y before bed, want me to set a 10-min timer?") Skip entirely if other signals are richer — habits are a nice-to-have, not a hard interrupt.

You should NOT ping for:
- Minor events far away (hours out, generic)
- Marketing / newsletters / routine emails
- Things the user already asked about this session
- The same topic as the last ping (listed below)
- Just because signals exist — silence is usually right

Output a SINGLE JSON object, no prose:
{ "ping": boolean, "message": string | null, "topic": string | null, "reason": string, "commitment_ids": string[] | null }

If ping=true:
- message: one casual sentence JARVIS would say on WhatsApp. Natural, warm, specific. Offer one next action if relevant ("want me to push the gym?"). Never start with "Hi" / "Hey" / "Just a heads-up".
- topic: 2-5 word label for what this was about ("3pm moved", "Daniel email", "Uber booked", "Ana deck overdue")
- reason: one-sentence justification
- commitment_ids: array of ids from the COMMITMENTS section if your ping is about one (or more) of them; else null / empty

If ping=false:
- message: null
- topic: null
- reason: why skipping (e.g. "nothing material", "dedupe vs last ping")
- commitment_ids: null

Bias toward SKIP. Only speak when a real PA would genuinely interrupt.`;

async function judge(
  anthropic: Anthropic,
  userName: string,
  signals: Signals,
  lastPingTopic: string | null,
): Promise<Decision> {
  const prompt = buildJudgePrompt(userName, signals, lastPingTopic);
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const parsed = extractJson(text);
    if (!parsed) return { ping: false, reason: "judge returned no JSON" };

    if (parsed.ping === true && typeof parsed.message === "string" && parsed.message.trim()) {
      const rawIds = parsed.commitment_ids;
      const commitmentIds = Array.isArray(rawIds)
        ? rawIds.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [];
      return {
        ping: true,
        message: parsed.message.trim().slice(0, 400),
        topic: typeof parsed.topic === "string" ? parsed.topic.slice(0, 60) : undefined,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        commitmentIds,
      };
    }
    return {
      ping: false,
      reason: typeof parsed.reason === "string" ? parsed.reason : "judge said skip",
    };
  } catch (e) {
    return { ping: false, reason: `judge failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export async function sendDemoProactivePing(
  admin: SupabaseClient,
  userId: string,
  toE164: string | null,
): Promise<void> {
  if (!toE164) return;
  const message = "Quick test — JARVIS reaching out on its own. If you see this, the proactive path works.";
  await sendProactivePing(admin, userId, toE164, message);
}

async function sendProactivePing(
  admin: SupabaseClient,
  userId: string,
  toE164: string,
  message: string,
): Promise<void> {
  // Write to the conversation thread too, so the user sees the ping in the
  // web/desktop chat log (not just on WhatsApp). Continue the most-recent
  // conversation if it's still warm (< 2h); otherwise start a new one.
  await appendProactiveToConversation(admin, userId, message);

  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel: "whatsapp",
      to_e164: toE164,
      body: message,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !notif) {
    console.warn("[proactive] notification insert failed:", error?.message);
    return;
  }
  try {
    await dispatchNotification(admin, notif.id as string);
  } catch (e) {
    console.warn("[proactive] dispatch failed:", e);
  }
}

async function appendProactiveToConversation(
  admin: SupabaseClient,
  userId: string,
  message: string,
): Promise<void> {
  const warmCutoff = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const { data: warm } = await admin
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .gte("updated_at", warmCutoff)
    .order("updated_at", { ascending: false })
    .limit(1);

  let conversationId: string;
  const warmFirst = warm?.[0];
  if (warmFirst) {
    conversationId = warmFirst.id as string;
  } else {
    const { data: fresh, error } = await admin
      .from("conversations")
      .insert({ user_id: userId, title: "JARVIS check-in" })
      .select("id")
      .single();
    if (error || !fresh) {
      console.warn("[proactive] conversation insert failed:", error?.message);
      return;
    }
    conversationId = fresh.id as string;
  }

  await admin.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content: message,
  });
  await admin
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

async function touchTick(
  admin: SupabaseClient,
  userId: string,
  cursors?: { last_seen_email_id?: string | null },
): Promise<void> {
  await admin
    .from("proactive_state")
    .update({
      last_tick_at: new Date().toISOString(),
      ...(cursors?.last_seen_email_id !== undefined
        ? { last_seen_email_id: cursors.last_seen_email_id }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

async function persistPing(
  admin: SupabaseClient,
  userId: string,
  state: ProactiveState,
  now: Date,
  topic: string | null,
  cursors: { last_seen_email_id?: string | null },
): Promise<void> {
  const todayKey = now.toISOString().slice(0, 10);
  const rolledOver = state.day_key !== todayKey;
  const nextCount = rolledOver ? 1 : state.pings_today + 1;
  await admin
    .from("proactive_state")
    .update({
      last_ping_at: now.toISOString(),
      last_tick_at: now.toISOString(),
      day_key: todayKey,
      pings_today: nextCount,
      last_ping_topic: topic,
      ...(cursors.last_seen_email_id !== undefined
        ? { last_seen_email_id: cursors.last_seen_email_id }
        : {}),
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId);
}

function advanceCursors(signals: Signals): { last_seen_email_id: string | null } {
  const topEmailId = signals.newEmails[0]?.id ?? null;
  return { last_seen_email_id: topEmailId };
}

