// Server-side runner for the evening wrap-up. Fires at 22:00 London time.
// Looks BACKWARDS at today (revenue landed, meetings attended, receipts,
// subscriptions that renewed) and FORWARD at tomorrow (first event + weather).
// Also surfaces open loops — tasks still in needs_approval or active.
//
// Degrades gracefully: any missing integration is silently dropped.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import {
  getPaymentProvider,
  getBankingProvider,
  type RevenueSummary,
  type SpendingSummary,
} from "@jarvis/integrations";
import { dispatchNotification } from "./notify";

type WrapArgs = {
  title?: string;
  notify?: boolean;
};

type CalendarEvent = {
  summary: string;
  start: string | null;
  end: string | null;
  attendees: string[];
};

type Receipt = {
  merchant: string;
  amount: number | null;
  currency: string;
  category: string | null;
};

type OpenLoop = {
  id: string;
  kind: string;
  status: string;
  prompt: string | null;
  needs_approval_at: string | null;
};

type CommitmentRecord = {
  direction: "inbound" | "outbound";
  other_party: string;
  commitment_text: string;
  deadline: string | null;
  overdue: boolean;
};

type IntentionStatus = {
  text: string;
  hit: boolean;
};

type CheckinSnapshot = {
  energy: number;
  mood: number;
  focus: number;
  note: string | null;
};

type WinTally = {
  total: number;
  by_kind: Record<string, number>;
  amount_cents: number;
};

type ReflectionEntry = {
  text: string;
  kind: string;
};

type Sections = {
  revenue: RevenueSummary[] | null;
  spending: SpendingSummary[] | null;
  calendarToday: CalendarEvent[] | null;
  calendarTomorrow: CalendarEvent[] | null;
  receiptsToday: Receipt[] | null;
  openLoops: OpenLoop[];
  weatherTomorrow: { high: number | null; low: number | null; conditions: string } | null;
  commitmentsTomorrow: CommitmentRecord[] | null;
  commitmentsClosedToday: CommitmentRecord[] | null;
  intention: IntentionStatus | null;
  winsToday: WinTally | null;
  checkinToday: CheckinSnapshot | null;
  milestonesToday: number;
  reflectionsToday: ReflectionEntry[] | null;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;

const DEFAULT_LAT = 51.5407;
const DEFAULT_LON = -0.0273;

export async function runEveningWrapTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[evening-wrap] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") return;

  const args: WrapArgs = task.args ?? {};
  const notify = args.notify ?? true;

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", taskId);

  const emit = async (kind: "text" | "progress" | "error", content: string | null) => {
    await admin.from("task_events").insert({
      task_id: taskId,
      user_id: task.user_id,
      kind,
      content,
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

    await emit("progress", "gathering day's data");

    const sections = await gatherSections(
      admin,
      task.user_id,
      profile?.google_access_token ?? null,
    );

    const wrap = await synthesise({
      anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
      sections,
      userName: profile?.display_name ?? "Reiss",
      onUsage: (u) => {
        inputTokens += u.input_tokens;
        outputTokens += u.output_tokens;
        cacheReadTokens += u.cache_read_input_tokens ?? 0;
      },
    });

    await admin
      .from("tasks")
      .update({
        status: "done",
        result: wrap,
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
      })
      .eq("id", taskId);

    if (notify && profile?.mobile_e164) {
      await sendWhatsApp(admin, task.user_id, taskId, profile.mobile_e164, wrap);
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
      })
      .eq("id", taskId);
  }
}

async function gatherSections(
  admin: SupabaseClient,
  userId: string,
  googleAccessToken: string | null,
): Promise<Sections> {
  const [
    revenue,
    spending,
    calendarToday,
    calendarTomorrow,
    receiptsToday,
    openLoops,
    weatherTomorrow,
    commitmentsTomorrow,
    commitmentsClosedToday,
    intention,
    winsToday,
    checkinToday,
    milestonesToday,
    reflectionsToday,
  ] = await Promise.all([
    pullRevenueToday(admin, userId),
    pullSpendingToday(admin, userId),
    pullCalendarFor(googleAccessToken, 0),
    pullCalendarFor(googleAccessToken, 1),
    pullReceiptsToday(admin, userId),
    pullOpenLoops(admin, userId),
    pullWeatherTomorrow(),
    pullCommitmentsTomorrow(admin, userId),
    pullCommitmentsClosedToday(admin, userId),
    pullIntentionToday(admin, userId),
    pullWinsToday(admin, userId),
    pullCheckinToday(admin, userId),
    pullMilestonesTickedToday(admin, userId),
    pullReflectionsToday(admin, userId),
  ]);
  return {
    revenue,
    spending,
    calendarToday,
    calendarTomorrow,
    receiptsToday,
    openLoops,
    weatherTomorrow,
    commitmentsTomorrow,
    commitmentsClosedToday,
    intention,
    winsToday,
    checkinToday,
    milestonesToday,
    reflectionsToday,
  };
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function pullIntentionToday(admin: SupabaseClient, userId: string): Promise<IntentionStatus | null> {
  try {
    const { data } = await admin
      .from("intentions")
      .select("text, completed_at")
      .eq("user_id", userId)
      .eq("log_date", todayYmd())
      .maybeSingle();
    if (!data) return null;
    const row = data as { text: string; completed_at: string | null };
    return { text: row.text, hit: Boolean(row.completed_at) };
  } catch {
    return null;
  }
}

async function pullWinsToday(admin: SupabaseClient, userId: string): Promise<WinTally | null> {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { data } = await admin
      .from("wins")
      .select("kind, amount_cents")
      .eq("user_id", userId)
      .gte("created_at", start.toISOString());
    const rows = (data ?? []) as Array<{ kind: string; amount_cents: number | null }>;
    if (rows.length === 0) return null;
    const by_kind: Record<string, number> = {};
    let amount = 0;
    for (const r of rows) {
      by_kind[r.kind] = (by_kind[r.kind] ?? 0) + 1;
      if (r.amount_cents) amount += r.amount_cents;
    }
    return { total: rows.length, by_kind, amount_cents: amount };
  } catch {
    return null;
  }
}

async function pullCheckinToday(admin: SupabaseClient, userId: string): Promise<CheckinSnapshot | null> {
  try {
    const { data } = await admin
      .from("daily_checkins")
      .select("energy, mood, focus, note")
      .eq("user_id", userId)
      .eq("log_date", todayYmd())
      .maybeSingle();
    if (!data) return null;
    const row = data as { energy: number; mood: number; focus: number; note: string | null };
    return { energy: row.energy, mood: row.mood, focus: row.focus, note: row.note };
  } catch {
    return null;
  }
}

async function pullMilestonesTickedToday(admin: SupabaseClient, userId: string): Promise<number> {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { data } = await admin
      .from("goals")
      .select("milestones, updated_at")
      .eq("user_id", userId)
      .gte("updated_at", start.toISOString());
    const rows = (data ?? []) as Array<{ milestones: Array<{ done_at: string | null }> }>;
    let count = 0;
    for (const r of rows) {
      for (const m of r.milestones ?? []) {
        if (m.done_at && new Date(m.done_at) >= start) count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function pullReflectionsToday(admin: SupabaseClient, userId: string): Promise<ReflectionEntry[] | null> {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { data } = await admin
      .from("reflections")
      .select("text, kind")
      .eq("user_id", userId)
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true })
      .limit(8);
    const rows = (data ?? []) as Array<{ text: string; kind: string }>;
    if (rows.length === 0) return null;
    return rows.map((r) => ({ text: r.text, kind: r.kind }));
  } catch {
    return null;
  }
}

async function pullCommitmentsTomorrow(
  admin: SupabaseClient,
  userId: string,
): Promise<CommitmentRecord[] | null> {
  try {
    const now = new Date();
    const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
    const { data } = await admin
      .from("commitments")
      .select("direction, other_party, commitment_text, deadline")
      .eq("user_id", userId)
      .eq("status", "open")
      .not("deadline", "is", null)
      .lte("deadline", endOfTomorrow.toISOString())
      .order("deadline", { ascending: true })
      .limit(12);
    if (!data) return null;
    const nowIso = now.toISOString();
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

async function pullCommitmentsClosedToday(
  admin: SupabaseClient,
  userId: string,
): Promise<CommitmentRecord[] | null> {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data } = await admin
      .from("commitments")
      .select("direction, other_party, commitment_text, deadline, status, updated_at")
      .eq("user_id", userId)
      .eq("status", "done")
      .gte("updated_at", startOfDay.toISOString())
      .order("updated_at", { ascending: false })
      .limit(12);
    if (!data) return null;
    const rows: CommitmentRecord[] = data.map((c) => ({
      direction: (c.direction as "inbound" | "outbound") ?? "outbound",
      other_party: (c.other_party as string) ?? "",
      commitment_text: (c.commitment_text as string) ?? "",
      deadline: (c.deadline as string | null) ?? null,
      overdue: false,
    }));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

async function pullRevenueToday(
  admin: SupabaseClient,
  userId: string,
): Promise<RevenueSummary[] | null> {
  try {
    const provider = await getPaymentProvider(admin, userId);
    return await provider.listRevenue("today");
  } catch {
    return null;
  }
}

async function pullSpendingToday(
  admin: SupabaseClient,
  userId: string,
): Promise<SpendingSummary[] | null> {
  try {
    const provider = await getBankingProvider(admin, userId);
    return await provider.getSpending({ range: "today" });
  } catch {
    return null;
  }
}

// dayOffset: 0 = today, 1 = tomorrow
async function pullCalendarFor(
  accessToken: string | null,
  dayOffset: number,
): Promise<CalendarEvent[] | null> {
  if (!accessToken) return null;
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth });
    const base = new Date();
    base.setDate(base.getDate() + dayOffset);
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59);
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    });
    return (res.data.items ?? []).map((e) => ({
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      attendees: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x)),
    }));
  } catch {
    return null;
  }
}

async function pullReceiptsToday(
  admin: SupabaseClient,
  userId: string,
): Promise<Receipt[] | null> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data, error } = await admin
    .from("receipts")
    .select("merchant, amount, currency, category")
    .eq("user_id", userId)
    .eq("archived", false)
    .gte("purchased_at", startOfDay.toISOString())
    .order("purchased_at", { ascending: false })
    .limit(20);
  if (error) return null;
  return (data as Receipt[] | null) ?? [];
}

async function pullOpenLoops(
  admin: SupabaseClient,
  userId: string,
): Promise<OpenLoop[]> {
  const { data, error } = await admin
    .from("tasks")
    .select("id, kind, status, prompt, needs_approval_at")
    .eq("user_id", userId)
    .in("status", ["needs_approval", "running", "queued"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return (data as OpenLoop[] | null) ?? [];
}

async function pullWeatherTomorrow(): Promise<
  { high: number | null; low: number | null; conditions: string } | null
> {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${DEFAULT_LAT}&longitude=${DEFAULT_LON}&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=2`,
    );
    const d = (await r.json()) as {
      daily?: {
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        weather_code: number[];
      };
    };
    if (!d.daily) return null;
    const code = d.daily.weather_code?.[1] ?? 0;
    return {
      high: d.daily.temperature_2m_max?.[1] ?? null,
      low: d.daily.temperature_2m_min?.[1] ?? null,
      conditions: weatherCodeToText(code),
    };
  } catch {
    return null;
  }
}

function weatherCodeToText(code: number): string {
  const map: Record<number, string> = {
    0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "fog",
    51: "drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    71: "light snow", 73: "snow", 75: "heavy snow",
    80: "showers", 81: "heavy showers", 82: "violent showers",
    95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm",
  };
  return map[code] ?? "mixed";
}

async function synthesise(input: {
  anthropic: Anthropic;
  sections: Sections;
  userName: string;
  onUsage: (u: Anthropic.Messages.Usage) => void;
}): Promise<string> {
  const { anthropic, sections, userName, onUsage } = input;

  const dataDump = buildDataDump(sections);
  const system = buildSystemPrompt(userName);

  let model = MODEL;
  let modelSwitched = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
  throw new Error("evening wrap synthesis failed");
}

function buildSystemPrompt(userName: string): string {
  return [
    `You are writing the evening wrap-up for ${userName} — a WhatsApp message they'll read before bed.`,
    "",
    "Output contract:",
    "- ~10-12 lines, plain text, WhatsApp-friendly (no markdown, no code blocks).",
    "- Open with a one-line framing of the day (quiet/busy/mixed).",
    "- Short section headers in CAPS (INTENTION, TODAY, WINS, CHECK-IN, REFLECTIONS, WRAPPED, OPEN LOOPS, PROMISES TOMORROW, TOMORROW). Only include a section if it has real data.",
    "- Under each: 1-3 tight bullet lines (prefix with •). Synthesise, don't list.",
    "- TODAY: revenue landed today, total spent today, meetings that happened (count + notable one), how many receipts were logged.",
    "- WRAPPED: commitments the user closed today (if any) — quick acknowledgement, don't dwell.",
    "- OPEN LOOPS: anything still needing approval or mid-flight — prioritise by age.",
    "- PROMISES TOMORROW: commitments still open with a deadline ≤ tomorrow (or already overdue) — flag these before bed. Group by 'I owe' vs 'they owe'. Name the counterparties.",
    "- TOMORROW: first event + count, tomorrow's weather if available.",
    "- Close with one line: either a subtle 'sleep on this' nudge about the biggest open loop, or a dry well-done if the day wrapped clean.",
    "- British English. Warm, direct, not corporate. No em-dashes.",
    "",
    "Do NOT invent facts. If a section is empty, skip it entirely. Never write 'no data'.",
  ].join("\n");
}

function buildDataDump(s: Sections): string {
  const parts: string[] = [];
  parts.push(
    `DATE: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`,
  );

  if (s.revenue && s.revenue.length > 0) {
    const lines = s.revenue.map((r) => {
      const gross = (r.gross_cents / 100).toFixed(2);
      const net = (r.net_cents / 100).toFixed(2);
      return `${r.currency.toUpperCase()}: gross ${gross}, net ${net}, ${r.charge_count} charge(s), ${r.refund_count} refund(s)`;
    });
    parts.push(`REVENUE (today):\n${lines.join("\n")}`);
  }

  if (s.spending && s.spending.length > 0) {
    const lines = s.spending.flatMap((sum) => {
      const header = `${sum.currency.toUpperCase()} spend ${(sum.total_spend_minor / 100).toFixed(2)}, income ${(sum.total_income_minor / 100).toFixed(2)}`;
      const buckets = sum.buckets
        .slice(0, 4)
        .map((b) => `  ${b.category}: ${(b.spend_minor / 100).toFixed(2)}`);
      return [header, ...buckets];
    });
    parts.push(`SPEND (today):\n${lines.join("\n")}`);
  }

  if (s.calendarToday && s.calendarToday.length > 0) {
    const lines = s.calendarToday.map((e) => {
      const t = e.start ? formatTime(e.start) : "all-day";
      const att = e.attendees.length > 0 ? ` with ${e.attendees.length}` : "";
      return `${t}: ${e.summary}${att}`;
    });
    parts.push(`CALENDAR (today, ${s.calendarToday.length} event(s)):\n${lines.join("\n")}`);
  }

  if (s.receiptsToday && s.receiptsToday.length > 0) {
    const lines = s.receiptsToday
      .slice(0, 8)
      .map((r) => {
        const amt = r.amount != null ? `${r.currency} ${r.amount.toFixed(2)}` : "?";
        const cat = r.category ? ` (${r.category})` : "";
        return `- ${r.merchant}: ${amt}${cat}`;
      });
    parts.push(`RECEIPTS (today, ${s.receiptsToday.length}):\n${lines.join("\n")}`);
  }

  if (s.openLoops && s.openLoops.length > 0) {
    const lines = s.openLoops.slice(0, 8).map((t) => {
      const summary = (t.prompt ?? t.kind).slice(0, 100).replace(/\s+/g, " ");
      return `- [${t.status}] ${t.kind}: ${summary}`;
    });
    parts.push(`OPEN LOOPS (${s.openLoops.length}):\n${lines.join("\n")}`);
  }

  if (s.calendarTomorrow && s.calendarTomorrow.length > 0) {
    const lines = s.calendarTomorrow.slice(0, 6).map((e) => {
      const t = e.start ? formatTime(e.start) : "all-day";
      return `${t}: ${e.summary}`;
    });
    parts.push(`TOMORROW CALENDAR (${s.calendarTomorrow.length} event(s)):\n${lines.join("\n")}`);
  }

  if (s.weatherTomorrow) {
    const hi = s.weatherTomorrow.high != null ? `${Math.round(s.weatherTomorrow.high)}°` : "?";
    const lo = s.weatherTomorrow.low != null ? `${Math.round(s.weatherTomorrow.low)}°` : "?";
    parts.push(`TOMORROW WEATHER: ${lo}–${hi}, ${s.weatherTomorrow.conditions}`);
  }

  if (s.commitmentsClosedToday && s.commitmentsClosedToday.length > 0) {
    const lines = s.commitmentsClosedToday.slice(0, 8).map((c) => {
      const who = c.direction === "outbound"
        ? `I delivered to ${c.other_party || "?"}`
        : `${c.other_party || "?"} delivered to me`;
      return `- ${who}: ${c.commitment_text}`;
    });
    parts.push(`COMMITMENTS CLOSED TODAY:\n${lines.join("\n")}`);
  }

  if (s.commitmentsTomorrow && s.commitmentsTomorrow.length > 0) {
    const lines = s.commitmentsTomorrow.map((c) => {
      const when = c.overdue
        ? `OVERDUE (${c.deadline ? formatRelativePast(c.deadline) : "?"})`
        : c.deadline
        ? `DUE ${formatShortDate(c.deadline)}`
        : "no deadline";
      const who = c.direction === "outbound"
        ? `I owe ${c.other_party || "?"}`
        : `${c.other_party || "?"} owes me`;
      return `${when} — ${who}: ${c.commitment_text}`;
    });
    parts.push(`PROMISES OPEN (due ≤ tomorrow or overdue):\n${lines.join("\n")}`);
  }

  if (s.intention) {
    const flag = s.intention.hit ? "HIT" : "missed";
    parts.push(`INTENTION (today): "${s.intention.text}" — ${flag}`);
  }

  if (s.winsToday && s.winsToday.total > 0) {
    const breakdown = Object.entries(s.winsToday.by_kind)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    const money = s.winsToday.amount_cents > 0
      ? ` · £${(s.winsToday.amount_cents / 100).toFixed(s.winsToday.amount_cents % 100 === 0 ? 0 : 2)}`
      : "";
    parts.push(`WINS LOGGED TODAY: ${s.winsToday.total} (${breakdown})${money}`);
  }

  if (s.milestonesToday > 0) {
    parts.push(`GOAL MILESTONES TICKED TODAY: ${s.milestonesToday}`);
  }

  if (s.checkinToday) {
    const note = s.checkinToday.note ? ` — "${s.checkinToday.note.slice(0, 120)}"` : "";
    parts.push(
      `CHECK-IN (today): energy ${s.checkinToday.energy}/5, mood ${s.checkinToday.mood}/5, focus ${s.checkinToday.focus}/5${note}`,
    );
  }

  if (s.reflectionsToday && s.reflectionsToday.length > 0) {
    const lines = s.reflectionsToday.map((r) => {
      const snip = r.text.slice(0, 200).replace(/\s+/g, " ");
      return `- [${r.kind}] ${snip}`;
    });
    parts.push(`REFLECTIONS KEPT TODAY (${s.reflectionsToday.length}):\n${lines.join("\n")}`);
  }

  return parts.join("\n\n");
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) return "today";
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate();
    if (isTomorrow) return "tomorrow";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

function formatRelativePast(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
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
  if (error || !notif) return;
  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[evening-wrap] dispatch failed:", e);
  }
}

function isOverloadedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}
