// Server-side runner for the morning briefing. Pulls revenue, spend, calendar,
// priority emails, birthdays and weather in parallel, synthesises a ~15-line
// WhatsApp briefing with Haiku, sends it, marks the task done.
//
// Designed to degrade gracefully: any section whose integration is missing
// (e.g. no Stripe connected) is silently dropped. A briefing with only
// calendar + weather is still useful.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import {
  getEmailProvider,
  getPaymentProvider,
  getBankingProvider,
  type EmailSummary,
  type RevenueSummary,
  type SpendingSummary,
} from "@jarvis/integrations";
import { makeVoyageEmbed, recallMemories } from "@jarvis/agent";
import { dispatchNotification } from "./notify";

type BriefingArgs = {
  title?: string;
  // Reserved for future config knobs (tone, length, sections enabled/disabled).
  notify?: boolean;
};

type CalendarEvent = {
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  attendees: string[];
};

type Weather = {
  location: string;
  temperature_c: number;
  conditions: string;
  today_high_c: number | null;
  today_low_c: number | null;
};

type CommitmentRecord = {
  direction: "inbound" | "outbound";
  other_party: string;
  commitment_text: string;
  deadline: string | null;
  overdue: boolean;
};

type IntentionSnapshot = {
  text: string;
  carried: boolean;
};

type GoalDueRecord = {
  title: string;
  target_date: string;
  progress_pct: number;
  days_until: number;
};

type FocusItem = {
  text: string;
  kind: string;
};

type RecentReflection = {
  text: string;
  kind: string;
  days_ago: number;
};

type Sections = {
  revenue: RevenueSummary[] | null;
  spending: SpendingSummary[] | null;
  emails: EmailSummary[] | null;
  calendar: CalendarEvent[] | null;
  birthdays: string[] | null;
  weather: Weather | null;
  commitments: CommitmentRecord[] | null;
  intention: IntentionSnapshot | null;
  goals_due: GoalDueRecord[] | null;
  open_question: FocusItem | null;
  hot_idea: FocusItem | null;
  recent_reflection: RecentReflection | null;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;
const MAX_EMAILS = 8;

const DEFAULT_LAT = 51.5407;
const DEFAULT_LON = -0.0273;
const DEFAULT_WEATHER_LABEL = "East London";

export async function runBriefingTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[briefing-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[briefing-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: BriefingArgs = task.args ?? {};
  const notify = args.notify ?? true;

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", taskId);

  const emit = async (
    kind: "text" | "progress" | "error",
    content: string | null,
    data: Record<string, unknown> | null = null,
  ) => {
    await admin.from("task_events").insert({
      task_id: taskId,
      user_id: task.user_id,
      kind,
      content,
      data,
    });
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name, mobile_e164, google_access_token")
      .eq("id", task.user_id)
      .single();

    await emit("progress", "gathering data");

    const sections = await gatherSections(admin, task.user_id, profile?.google_access_token ?? null);

    const briefing = await synthesise({
      anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
      sections,
      userName: profile?.display_name ?? "Reiss",
      onUsage: (u) => {
        inputTokens += u.input_tokens;
        outputTokens += u.output_tokens;
        cacheReadTokens += u.cache_read_input_tokens ?? 0;
      },
      onProgress: (msg) => void emit("progress", msg),
    });

    const costUsd = estimateCost(inputTokens, outputTokens, cacheReadTokens);

    await admin
      .from("tasks")
      .update({
        status: "done",
        result: briefing,
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cost_usd: costUsd,
      })
      .eq("id", taskId);

    if (notify && profile?.mobile_e164) {
      await sendWhatsApp(admin, task.user_id, taskId, profile.mobile_e164, briefing);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit("error", msg);
    await admin
      .from("tasks")
      .update({
        status: "failed",
        error: msg,
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
      })
      .eq("id", taskId);
  }
}

async function gatherSections(
  admin: SupabaseClient,
  userId: string,
  googleAccessToken: string | null,
): Promise<Sections> {
  const [revenue, spending, emails, calendar, birthdays, weather, commitments, intention, goalsDue, openQuestion, hotIdea, recentReflection] = await Promise.all([
    pullRevenue(admin, userId),
    pullSpending(admin, userId),
    pullEmails(admin, userId),
    pullCalendar(googleAccessToken),
    pullBirthdays(admin, userId),
    pullWeather(),
    pullCommitments(admin, userId),
    pullIntention(admin, userId),
    pullGoalsDue(admin, userId),
    pullOpenQuestion(admin, userId),
    pullHotIdea(admin, userId),
    pullRecentReflection(admin, userId),
  ]);
  return {
    revenue,
    spending,
    emails,
    calendar,
    birthdays,
    weather,
    commitments,
    intention,
    goals_due: goalsDue,
    open_question: openQuestion,
    hot_idea: hotIdea,
    recent_reflection: recentReflection,
  };
}

async function pullIntention(admin: SupabaseClient, userId: string): Promise<IntentionSnapshot | null> {
  try {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const { data } = await admin
      .from("intentions")
      .select("text, carried_from")
      .eq("user_id", userId)
      .eq("log_date", ymd)
      .maybeSingle();
    if (!data) return null;
    const row = data as { text: string; carried_from: string | null };
    return { text: row.text, carried: Boolean(row.carried_from) };
  } catch {
    return null;
  }
}

async function pullGoalsDue(admin: SupabaseClient, userId: string): Promise<GoalDueRecord[] | null> {
  try {
    const today = new Date();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 14);
    const horizonStr = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, "0")}-${String(horizon.getDate()).padStart(2, "0")}`;
    const { data } = await admin
      .from("goals")
      .select("title, target_date, progress_pct")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("target_date", "is", null)
      .lte("target_date", horizonStr)
      .order("target_date", { ascending: true })
      .limit(5);
    if (!data || data.length === 0) return null;
    return (data as Array<{ title: string; target_date: string; progress_pct: number }>).map((g) => {
      const target = new Date(g.target_date + "T00:00:00");
      const days = Math.round((target.getTime() - today.getTime()) / 86400000);
      return { title: g.title, target_date: g.target_date, progress_pct: g.progress_pct, days_until: days };
    });
  } catch {
    return null;
  }
}

async function pullOpenQuestion(admin: SupabaseClient, userId: string): Promise<FocusItem | null> {
  try {
    const { data } = await admin
      .from("questions")
      .select("text, kind")
      .eq("user_id", userId)
      .in("status", ["open", "exploring"])
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { text: string; kind: string };
    return { text: row.text, kind: row.kind };
  } catch {
    return null;
  }
}

async function pullHotIdea(admin: SupabaseClient, userId: string): Promise<FocusItem | null> {
  try {
    const { data } = await admin
      .from("ideas")
      .select("text, kind, heat")
      .eq("user_id", userId)
      .in("status", ["fresh", "exploring"])
      .gte("heat", 4)
      .order("heat", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { text: string; kind: string };
    return { text: row.text, kind: row.kind };
  } catch {
    return null;
  }
}

async function pullRecentReflection(admin: SupabaseClient, userId: string): Promise<RecentReflection | null> {
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await admin
      .from("reflections")
      .select("text, kind, created_at")
      .eq("user_id", userId)
      .in("kind", ["lesson", "realisation"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { text: string; kind: string; created_at: string };
    const days = Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000));
    return { text: row.text, kind: row.kind, days_ago: days };
  } catch {
    return null;
  }
}

// At 7am "today" hasn't happened yet, so revenue/spend look BACKWARDS at
// yesterday (the last closed day). Calendar/weather look FORWARD at today —
// that's the "day ahead" framing.
async function pullRevenue(admin: SupabaseClient, userId: string): Promise<RevenueSummary[] | null> {
  try {
    const provider = await getPaymentProvider(admin, userId);
    return await provider.listRevenue("yesterday");
  } catch {
    return null;
  }
}

async function pullSpending(admin: SupabaseClient, userId: string): Promise<SpendingSummary[] | null> {
  try {
    const provider = await getBankingProvider(admin, userId);
    return await provider.getSpending({ range: "yesterday" });
  } catch {
    return null;
  }
}

async function pullEmails(admin: SupabaseClient, userId: string): Promise<EmailSummary[] | null> {
  try {
    const provider = await getEmailProvider(admin, userId);
    return await provider.list({ query: "is:unread newer_than:1d", max: MAX_EMAILS });
  } catch {
    return null;
  }
}

async function pullCalendar(accessToken: string | null): Promise<CalendarEvent[] | null> {
  if (!accessToken) return null;
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth });
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    });
    return (res.data.items ?? []).map((e) => ({
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      location: e.location ?? null,
      attendees: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x)),
    }));
  } catch {
    return null;
  }
}

async function pullBirthdays(admin: SupabaseClient, userId: string): Promise<string[] | null> {
  try {
    const voyageKey = process.env.VOYAGE_API_KEY;
    if (!voyageKey) return null;
    const embed = makeVoyageEmbed(voyageKey);
    const today = new Date();
    const monthName = today.toLocaleString("en-GB", { month: "long" });
    const day = today.getDate();
    const results = await recallMemories(admin, embed, {
      userId,
      query: `birthday on ${monthName} ${day}`,
      topK: 5,
    });
    const hits = results
      .map((m) => m.content)
      .filter((c) => /birthday|b-?day|born/i.test(c));
    return hits.length > 0 ? hits : null;
  } catch {
    return null;
  }
}

async function pullCommitments(admin: SupabaseClient, userId: string): Promise<CommitmentRecord[] | null> {
  try {
    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const nowIso = now.toISOString();
    const { data } = await admin
      .from("commitments")
      .select("direction, other_party, commitment_text, deadline, status")
      .eq("user_id", userId)
      .eq("status", "open")
      .not("deadline", "is", null)
      .lte("deadline", endOfDay.toISOString())
      .order("deadline", { ascending: true })
      .limit(15);
    if (!data) return null;
    const rows: CommitmentRecord[] = data.map((c) => ({
      direction: (c.direction as "inbound" | "outbound") ?? "outbound",
      other_party: (c.other_party as string) ?? "",
      commitment_text: (c.commitment_text as string) ?? "",
      deadline: (c.deadline as string | null) ?? null,
      overdue: Boolean(c.deadline && (c.deadline as string) < nowIso),
    }));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

async function pullWeather(): Promise<Weather | null> {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${DEFAULT_LAT}&longitude=${DEFAULT_LON}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`,
    );
    const d = (await r.json()) as {
      current?: { temperature_2m: number; weather_code: number };
      daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    if (!d.current) return null;
    return {
      location: DEFAULT_WEATHER_LABEL,
      temperature_c: d.current.temperature_2m,
      conditions: weatherCodeToText(d.current.weather_code),
      today_high_c: d.daily?.temperature_2m_max?.[0] ?? null,
      today_low_c: d.daily?.temperature_2m_min?.[0] ?? null,
    };
  } catch {
    return null;
  }
}

function weatherCodeToText(code: number): string {
  const map: Record<number, string> = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    71: "light snow", 73: "snow", 75: "heavy snow",
    80: "rain showers", 81: "heavy rain showers", 82: "violent rain showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
  };
  return map[code] ?? `code ${code}`;
}

async function synthesise(input: {
  anthropic: Anthropic;
  sections: Sections;
  userName: string;
  onUsage: (u: Anthropic.Messages.Usage) => void;
  onProgress: (msg: string) => void;
}): Promise<string> {
  const { anthropic, sections, userName, onUsage, onProgress } = input;

  const dataDump = buildDataDump(sections);
  const system = buildSystemPrompt(userName);

  let model = MODEL;
  let modelSwitched = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      onProgress(`synthesising with ${model}`);
      const res = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: dataDump }],
      });
      onUsage(res.usage);
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no text block in synthesis response");
      return block.text.trim();
    } catch (e) {
      if (!modelSwitched && isOverloadedError(e)) {
        modelSwitched = true;
        model = FALLBACK_MODEL;
        continue;
      }
      throw e;
    }
  }
  throw new Error("briefing synthesis failed");
}

function buildSystemPrompt(userName: string): string {
  return [
    `You are writing the morning briefing for ${userName} — a WhatsApp message they'll read over their first coffee.`,
    "",
    "Output contract:",
    "- ~15 lines, plain text, WhatsApp-friendly (no markdown, no code blocks, no emojis in excess).",
    "- Start with a one-line greeting referencing the weather or the shape of the day.",
    "- Use short section headers in CAPS (e.g. INTENTION, REVENUE, SPEND, CALENDAR, INBOX, PROMISES, BIRTHDAYS, GOALS, QUESTION, IDEA, REMEMBER) — ONLY include a section if there is real data for it. Never write 'no data' or 'not available'.",
    "- Under each header, 1-3 tight bullet lines (prefix with •). Synthesise, don't list — e.g. 'CALENDAR: 3 meetings, first is 10am standup, big one is the 2pm investor call.'",
    "- Framing: revenue/spend numbers are YESTERDAY (the last closed day — not today, which hasn't happened). Calendar/weather are TODAY AHEAD. Email is overnight unread.",
    "- Highlight anything unusual or that deserves attention (a failed charge, a big spend spike, a VIP email, a birthday).",
    "- Close with one line: the single most important thing to focus on today, or a dry one-liner if it's a quiet day.",
    "- British English. Punchy, warm, direct. No corporate filler, no 'Good morning! Here's your briefing' openings. No em-dashes.",
    "",
    "Do NOT invent facts. If a section is empty or missing, skip it entirely.",
  ].join("\n");
}

function buildDataDump(s: Sections): string {
  const parts: string[] = [];
  parts.push(`DATE: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`);

  if (s.weather) {
    const { location, temperature_c, conditions, today_high_c, today_low_c } = s.weather;
    const range = today_high_c !== null && today_low_c !== null ? `, ${Math.round(today_low_c)}°–${Math.round(today_high_c)}°` : "";
    parts.push(`WEATHER (${location}): ${Math.round(temperature_c)}°C now, ${conditions}${range}`);
  }

  if (s.revenue && s.revenue.length > 0) {
    const lines = s.revenue.map((r) => {
      const gross = (r.gross_cents / 100).toFixed(2);
      const net = (r.net_cents / 100).toFixed(2);
      return `${r.currency.toUpperCase()}: gross ${gross}, net ${net}, ${r.charge_count} charge(s), ${r.refund_count} refund(s)`;
    });
    parts.push(`REVENUE (yesterday):\n${lines.join("\n")}`);
  } else if (s.revenue && s.revenue.length === 0) {
    parts.push(`REVENUE (yesterday): no activity`);
  }

  if (s.spending && s.spending.length > 0) {
    const lines = s.spending.flatMap((sum) => {
      const header = `${sum.currency.toUpperCase()} total spend ${(sum.total_spend_minor / 100).toFixed(2)}, income ${(sum.total_income_minor / 100).toFixed(2)}`;
      const buckets = sum.buckets
        .slice(0, 5)
        .map((b) => `  ${b.category}: ${(b.spend_minor / 100).toFixed(2)}`);
      return [header, ...buckets];
    });
    parts.push(`SPEND (yesterday):\n${lines.join("\n")}`);
  }

  if (s.calendar && s.calendar.length > 0) {
    const lines = s.calendar.map((e) => {
      const t = e.start ? formatTime(e.start) : "all-day";
      const loc = e.location ? ` @ ${e.location}` : "";
      const att = e.attendees.length > 0 ? ` with ${e.attendees.length}` : "";
      return `${t}: ${e.summary}${loc}${att}`;
    });
    parts.push(`CALENDAR (${s.calendar.length} event(s)):\n${lines.join("\n")}`);
  } else if (s.calendar && s.calendar.length === 0) {
    parts.push(`CALENDAR: empty`);
  }

  if (s.emails && s.emails.length > 0) {
    const lines = s.emails.map((e) => {
      const snip = e.snippet.slice(0, 120).replace(/\s+/g, " ");
      return `- ${e.from} | ${e.subject} | ${snip}`;
    });
    parts.push(`UNREAD EMAILS (${s.emails.length}):\n${lines.join("\n")}`);
  }

  if (s.birthdays && s.birthdays.length > 0) {
    parts.push(`POSSIBLE BIRTHDAYS TODAY (from memory, may be noisy):\n${s.birthdays.map((b) => `- ${b}`).join("\n")}`);
  }

  if (s.commitments && s.commitments.length > 0) {
    const lines = s.commitments.map((c) => {
      const when = c.overdue
        ? `OVERDUE (${c.deadline ? formatRelativePast(c.deadline) : "?"})`
        : `DUE ${c.deadline ? formatTime(c.deadline) : "today"}`;
      const who = c.direction === "outbound"
        ? `I promised ${c.other_party || "?"}`
        : `${c.other_party || "?"} owes me`;
      return `${when} — ${who}: ${c.commitment_text}`;
    });
    parts.push(`PROMISES DUE / OVERDUE:\n${lines.join("\n")}`);
  }

  if (s.intention) {
    const carried = s.intention.carried ? " (carried over from yesterday)" : "";
    parts.push(`INTENTION (today)${carried}: ${s.intention.text}`);
  }

  if (s.goals_due && s.goals_due.length > 0) {
    const lines = s.goals_due.map((g) => {
      const when = g.days_until < 0 ? `overdue ${-g.days_until}d` : g.days_until === 0 ? "due today" : `${g.days_until}d`;
      return `${g.title} — ${g.progress_pct}% — ${when} (target ${g.target_date})`;
    });
    parts.push(`GOALS DUE WITHIN 14 DAYS:\n${lines.join("\n")}`);
  }

  if (s.open_question) {
    parts.push(`TOP OPEN QUESTION (${s.open_question.kind}): ${s.open_question.text}`);
  }

  if (s.hot_idea) {
    parts.push(`HOT IDEA (${s.hot_idea.kind}, heat 4-5): ${s.hot_idea.text}`);
  }

  if (s.recent_reflection) {
    const ago = s.recent_reflection.days_ago === 0 ? "today" : `${s.recent_reflection.days_ago}d ago`;
    parts.push(`REMEMBER (${s.recent_reflection.kind}, ${ago}): ${s.recent_reflection.text}`);
  }

  return parts.join("\n\n");
}

function formatRelativePast(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    if (diffMs < 0) return "soon";
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (days >= 1) return `${days}d ago`;
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    if (hours >= 1) return `${hours}h ago`;
    return "just now";
  } catch {
    return "?";
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function sendWhatsApp(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  toE164: string,
  body: string,
): Promise<void> {
  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      task_id: taskId,
      channel: "whatsapp",
      to_e164: toE164,
      body,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !notif) {
    console.warn("[briefing-run] notification insert failed:", error?.message);
    return;
  }
  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[briefing-run] dispatch failed:", e);
  }
}

function isOverloadedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}

function estimateCost(input: number, output: number, cacheRead: number): number {
  const inputNonCached = Math.max(0, input - cacheRead);
  const cost =
    (inputNonCached / 1_000_000) * 1.0 +
    (cacheRead / 1_000_000) * 0.1 +
    (output / 1_000_000) * 5.0;
  return Math.round(cost * 10000) / 10000;
}
