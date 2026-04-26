// Server-side runner for the Sunday weekly review. Fires at 18:00 London.
// Looks at the last 7 days: revenue trend, biggest spend, meetings load,
// what got shipped (tasks done) vs slipped (still needs_approval/running),
// top merchants (receipts), subscription renewals that hit, and a peek at
// the week ahead (calendar density).
//
// This is the one that should feel like a founder's Sunday planning session —
// a mirror, not a nag.

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

type ReviewArgs = {
  title?: string;
  notify?: boolean;
};

type CalendarEvent = {
  summary: string;
  start: string | null;
  attendees: string[];
};

type MerchantTotal = {
  merchant: string;
  total: number;
  currency: string;
  count: number;
};

type TaskBucket = {
  done: Array<{ kind: string; prompt: string | null }>;
  slipped: Array<{ kind: string; status: string; prompt: string | null }>;
};

type SubscriptionRenewal = {
  service_name: string;
  amount: number | null;
  currency: string | null;
};

type CommitmentBucket = {
  closed: Array<{ direction: "inbound" | "outbound"; other_party: string; commitment_text: string }>;
  stillOpen: Array<{
    direction: "inbound" | "outbound";
    other_party: string;
    commitment_text: string;
    deadline: string | null;
    overdue: boolean;
  }>;
};

type Sections = {
  revenueWeek: RevenueSummary[] | null;
  spendingWeek: SpendingSummary[] | null;
  calendarPast: CalendarEvent[] | null;
  calendarAhead: CalendarEvent[] | null;
  topMerchants: MerchantTotal[];
  tasks: TaskBucket;
  renewalsThisWeek: SubscriptionRenewal[];
  commitments: CommitmentBucket;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1800;

export async function runWeeklyReviewTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[weekly-review] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") return;

  const args: ReviewArgs = task.args ?? {};
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

    await emit("progress", "gathering last 7 days");

    const sections = await gatherSections(
      admin,
      task.user_id,
      profile?.google_access_token ?? null,
    );

    const review = await synthesise({
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
        result: review,
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
      })
      .eq("id", taskId);

    if (notify && profile?.mobile_e164) {
      await sendWhatsApp(admin, task.user_id, taskId, profile.mobile_e164, review);
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
    revenueWeek,
    spendingWeek,
    calendarPast,
    calendarAhead,
    topMerchants,
    tasks,
    renewalsThisWeek,
    commitments,
  ] = await Promise.all([
    pullRevenueWeek(admin, userId),
    pullSpendingWeek(admin, userId),
    pullCalendarPast(googleAccessToken),
    pullCalendarAhead(googleAccessToken),
    pullTopMerchants(admin, userId),
    pullTaskBuckets(admin, userId),
    pullRenewalsThisWeek(admin, userId),
    pullCommitmentsWeek(admin, userId),
  ]);
  return {
    revenueWeek,
    spendingWeek,
    calendarPast,
    calendarAhead,
    topMerchants,
    tasks,
    renewalsThisWeek,
    commitments,
  };
}

async function pullCommitmentsWeek(
  admin: SupabaseClient,
  userId: string,
): Promise<CommitmentBucket> {
  const bucket: CommitmentBucket = { closed: [], stillOpen: [] };
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const now = new Date();
    const nowIso = now.toISOString();

    const { data: closed } = await admin
      .from("commitments")
      .select("direction, other_party, commitment_text, status, updated_at")
      .eq("user_id", userId)
      .eq("status", "done")
      .gte("updated_at", weekAgo)
      .order("updated_at", { ascending: false })
      .limit(20);

    bucket.closed = (closed ?? []).map((c) => ({
      direction: (c.direction as "inbound" | "outbound") ?? "outbound",
      other_party: (c.other_party as string) ?? "",
      commitment_text: (c.commitment_text as string) ?? "",
    }));

    const { data: open } = await admin
      .from("commitments")
      .select("direction, other_party, commitment_text, deadline, status")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(15);

    bucket.stillOpen = (open ?? []).map((c) => ({
      direction: (c.direction as "inbound" | "outbound") ?? "outbound",
      other_party: (c.other_party as string) ?? "",
      commitment_text: (c.commitment_text as string) ?? "",
      deadline: (c.deadline as string | null) ?? null,
      overdue: Boolean(c.deadline && (c.deadline as string) < nowIso),
    }));
  } catch {
    // leave buckets empty
  }
  return bucket;
}

async function pullRevenueWeek(
  admin: SupabaseClient,
  userId: string,
): Promise<RevenueSummary[] | null> {
  try {
    const provider = await getPaymentProvider(admin, userId);
    return await provider.listRevenue("week");
  } catch {
    return null;
  }
}

async function pullSpendingWeek(
  admin: SupabaseClient,
  userId: string,
): Promise<SpendingSummary[] | null> {
  try {
    const provider = await getBankingProvider(admin, userId);
    return await provider.getSpending({ range: "week" });
  } catch {
    return null;
  }
}

async function pullCalendarPast(accessToken: string | null): Promise<CalendarEvent[] | null> {
  if (!accessToken) return null;
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth });
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    return (res.data.items ?? []).map((e) => ({
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      attendees: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x)),
    }));
  } catch {
    return null;
  }
}

async function pullCalendarAhead(accessToken: string | null): Promise<CalendarEvent[] | null> {
  if (!accessToken) return null;
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth });
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    return (res.data.items ?? []).map((e) => ({
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      attendees: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x)),
    }));
  } catch {
    return null;
  }
}

async function pullTopMerchants(
  admin: SupabaseClient,
  userId: string,
): Promise<MerchantTotal[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data, error } = await admin
    .from("receipts")
    .select("merchant, amount, currency")
    .eq("user_id", userId)
    .eq("archived", false)
    .gte("purchased_at", sevenDaysAgo.toISOString())
    .limit(200);
  if (error || !data) return [];

  const byMerchant = new Map<string, MerchantTotal>();
  for (const r of data as Array<{ merchant: string; amount: number | null; currency: string }>) {
    if (r.amount == null) continue;
    const key = `${r.merchant.toLowerCase()}|${r.currency}`;
    const existing = byMerchant.get(key);
    if (existing) {
      existing.total += Number(r.amount);
      existing.count += 1;
    } else {
      byMerchant.set(key, {
        merchant: r.merchant,
        total: Number(r.amount),
        currency: r.currency,
        count: 1,
      });
    }
  }
  return Array.from(byMerchant.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

async function pullTaskBuckets(
  admin: SupabaseClient,
  userId: string,
): Promise<TaskBucket> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data, error } = await admin
    .from("tasks")
    .select("kind, status, prompt, created_at")
    .eq("user_id", userId)
    .gte("created_at", sevenDaysAgo.toISOString())
    .limit(200);
  if (error || !data) return { done: [], slipped: [] };

  const done: TaskBucket["done"] = [];
  const slipped: TaskBucket["slipped"] = [];
  for (const t of data as Array<{ kind: string; status: string; prompt: string | null }>) {
    if (t.status === "done") done.push({ kind: t.kind, prompt: t.prompt });
    else if (["needs_approval", "running", "queued", "failed"].includes(t.status)) {
      slipped.push({ kind: t.kind, status: t.status, prompt: t.prompt });
    }
  }
  return { done, slipped };
}

async function pullRenewalsThisWeek(
  admin: SupabaseClient,
  userId: string,
): Promise<SubscriptionRenewal[]> {
  const now = new Date();
  const sevenDaysAhead = new Date(now);
  sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7);
  const { data, error } = await admin
    .from("subscriptions")
    .select("service_name, amount, currency, next_renewal_date")
    .eq("user_id", userId)
    .in("status", ["active", "trial"])
    .not("next_renewal_date", "is", null)
    .lte("next_renewal_date", sevenDaysAhead.toISOString().slice(0, 10))
    .gte("next_renewal_date", now.toISOString().slice(0, 10))
    .order("next_renewal_date", { ascending: true })
    .limit(10);
  if (error || !data) return [];
  return (data as Array<{ service_name: string; amount: number | null; currency: string | null }>).map(
    (r) => ({ service_name: r.service_name, amount: r.amount, currency: r.currency }),
  );
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
  throw new Error("weekly review synthesis failed");
}

function buildSystemPrompt(userName: string): string {
  return [
    `You are writing the Sunday weekly review for ${userName} — a WhatsApp message they'll read before the week kicks off.`,
    "",
    "Output contract:",
    "- ~18-22 lines, plain text, WhatsApp-friendly (no markdown, no code blocks).",
    "- Open with a one-line framing of the week (heads-down, chaotic, flat, momentum, etc).",
    "- Section headers in CAPS (WEEK DONE, MONEY, SHIPPED, SLIPPED, PROMISES, WEEK AHEAD). Only include sections with real data.",
    "- Under each: 2-4 tight bullet lines (prefix with •). Synthesise, don't list raw rows.",
    "- WEEK DONE: meetings count, notable patterns (most common people, back-to-back days, quiet days).",
    "- MONEY: week revenue total, biggest spend categories, top 2-3 merchants from receipts, upcoming subscription renewals next 7d.",
    "- SHIPPED: highlights from completed tasks — what got done. Include commitments closed this week (you followed through on X).",
    "- SLIPPED: still needs_approval or running — the open loops going into Monday.",
    "- PROMISES: commitments still open going into Monday. Lead with overdue ones (name counterparties). Be specific — this is the most actionable section.",
    "- WEEK AHEAD: meeting density, biggest event, renewals that will hit.",
    "- Close with two lines: 'FOCUS THIS WEEK:' followed by the single biggest thing you'd double down on, based on signal in the data.",
    "- British English. Founder tone — honest, dry, pattern-aware, not cheerleader. No em-dashes.",
    "",
    "Do NOT invent facts. If a section is empty, skip it entirely. Never write 'no data'.",
  ].join("\n");
}

function buildDataDump(s: Sections): string {
  const parts: string[] = [];
  parts.push(
    `WEEK ENDING: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`,
  );

  if (s.revenueWeek && s.revenueWeek.length > 0) {
    const lines = s.revenueWeek.map((r) => {
      const gross = (r.gross_cents / 100).toFixed(2);
      const net = (r.net_cents / 100).toFixed(2);
      return `${r.currency.toUpperCase()}: gross ${gross}, net ${net}, ${r.charge_count} charges, ${r.refund_count} refunds`;
    });
    parts.push(`REVENUE (last 7d):\n${lines.join("\n")}`);
  }

  if (s.spendingWeek && s.spendingWeek.length > 0) {
    const lines = s.spendingWeek.flatMap((sum) => {
      const header = `${sum.currency.toUpperCase()} spend ${(sum.total_spend_minor / 100).toFixed(2)}`;
      const buckets = sum.buckets
        .slice(0, 6)
        .map((b) => `  ${b.category}: ${(b.spend_minor / 100).toFixed(2)}`);
      return [header, ...buckets];
    });
    parts.push(`SPEND (last 7d):\n${lines.join("\n")}`);
  }

  if (s.topMerchants.length > 0) {
    const lines = s.topMerchants.map(
      (m) => `- ${m.merchant}: ${m.currency} ${m.total.toFixed(2)} across ${m.count} receipt(s)`,
    );
    parts.push(`TOP MERCHANTS (last 7d, one-off purchases):\n${lines.join("\n")}`);
  }

  if (s.calendarPast && s.calendarPast.length > 0) {
    const peopleCount: Record<string, number> = {};
    for (const e of s.calendarPast) {
      for (const a of e.attendees) peopleCount[a] = (peopleCount[a] ?? 0) + 1;
    }
    const topPeople = Object.entries(peopleCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([email, count]) => `${email} (${count}x)`);
    parts.push(
      `CALENDAR PAST 7D: ${s.calendarPast.length} event(s). Most-seen: ${topPeople.join(", ") || "mostly solo"}`,
    );
  }

  if (s.tasks.done.length > 0) {
    const byKind: Record<string, number> = {};
    for (const t of s.tasks.done) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    const kindSummary = Object.entries(byKind)
      .map(([k, n]) => `${k}×${n}`)
      .join(", ");
    const samplePrompts = s.tasks.done
      .slice(0, 6)
      .map((t) => `- [${t.kind}] ${(t.prompt ?? "").slice(0, 100)}`);
    parts.push(`TASKS DONE (${s.tasks.done.length}, kinds: ${kindSummary}):\n${samplePrompts.join("\n")}`);
  }

  if (s.tasks.slipped.length > 0) {
    const lines = s.tasks.slipped
      .slice(0, 8)
      .map((t) => `- [${t.status}/${t.kind}] ${(t.prompt ?? "").slice(0, 100)}`);
    parts.push(`OPEN LOOPS (${s.tasks.slipped.length}):\n${lines.join("\n")}`);
  }

  if (s.renewalsThisWeek.length > 0) {
    const lines = s.renewalsThisWeek.map(
      (r) => `- ${r.service_name}${r.amount != null ? `: ${r.currency ?? "GBP"} ${Number(r.amount).toFixed(2)}` : ""}`,
    );
    parts.push(`RENEWALS COMING (next 7d):\n${lines.join("\n")}`);
  }

  if (s.calendarAhead && s.calendarAhead.length > 0) {
    const lines = s.calendarAhead.slice(0, 10).map((e) => {
      const t = e.start ? formatDateTime(e.start) : "all-day";
      return `${t}: ${e.summary}`;
    });
    parts.push(`CALENDAR NEXT 7D (${s.calendarAhead.length} event(s)):\n${lines.join("\n")}`);
  }

  if (s.commitments.closed.length > 0) {
    const lines = s.commitments.closed.slice(0, 10).map((c) => {
      const who = c.direction === "outbound"
        ? `delivered to ${c.other_party || "?"}`
        : `${c.other_party || "?"} delivered`;
      return `- ${who}: ${c.commitment_text}`;
    });
    parts.push(`COMMITMENTS CLOSED THIS WEEK (${s.commitments.closed.length}):\n${lines.join("\n")}`);
  }

  if (s.commitments.stillOpen.length > 0) {
    const lines = s.commitments.stillOpen.slice(0, 12).map((c) => {
      const when = c.overdue
        ? `OVERDUE`
        : c.deadline
        ? `due ${new Date(c.deadline).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`
        : "no deadline";
      const who = c.direction === "outbound"
        ? `I owe ${c.other_party || "?"}`
        : `${c.other_party || "?"} owes me`;
      return `- ${when} — ${who}: ${c.commitment_text}`;
    });
    parts.push(`OPEN PROMISES (${s.commitments.stillOpen.length}):\n${lines.join("\n")}`);
  }

  return parts.join("\n\n");
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString("en-GB", { weekday: "short" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `${day} ${time}`;
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
    console.warn("[weekly-review] dispatch failed:", e);
  }
}

function isOverloadedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}
