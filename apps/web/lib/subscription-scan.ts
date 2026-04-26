// Subscription scanner. Sweeps the user's recent email for receipts, renewal
// notices, and trial warnings; asks Haiku to extract each recurring charge;
// upserts rows in `subscriptions`. Idempotent on re-run via dedup_key so it's
// safe to schedule weekly. Notifies the user when new subs are found.
//
// Paired with the brain tools in packages/agent/src/tools/subscriptions.ts and
// the proactive signal in proactive-run.ts (trial-ending + new-sub alerts).
//
// Data source today: email only. Follow-ups: bank feeds (Plaid/TrueLayer),
// card statements (Apple/Google Pay receipts), which land the "all your subs
// in one place" pitch even for tools that don't email.
//
// Runs server-side (no device needed). Invoked via tasks table + fetch, like
// inbox-run.ts.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getEmailProvider,
  getBankingProvider,
  type EmailSummary,
  type Transaction,
} from "@jarvis/integrations";
import { dispatchNotification } from "./notify";

type ScanArgs = {
  title?: string;
  query?: string;
  max?: number;
  notify?: boolean;
};

type Cadence = "weekly" | "monthly" | "quarterly" | "annual" | "unknown";
type Status = "active" | "trial" | "cancelled" | "paused" | "unknown";

type Extracted = {
  service_name: string;
  amount: number | null;
  currency: string | null;
  cadence: Cadence;
  next_renewal_date: string | null;
  status: Status;
  category: string | null;
  confidence: number;
  source: "email" | "bank";
  source_email_id: string | null;
  last_charged_at: string | null;
  reasoning: string;
};

export type SubscriptionScanResult = {
  scanned_emails: number;
  scanned_transactions: number;
  new_subs: number;
  updated_subs: number;
  skipped: number;
  monthly_total_gbp: number;
  subs: Array<{
    service_name: string;
    amount: number | null;
    currency: string;
    cadence: Cadence;
    status: Status;
    next_renewal_date: string | null;
    detection_source: string;
    is_new: boolean;
  }>;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 8000;
const MAX_BODY_CHARS = 1200;

// Default Gmail query. Wide net — Haiku filters further.
const DEFAULT_QUERY = [
  "newer_than:90d",
  "(receipt OR invoice OR subscription OR renewal OR membership OR",
  '"auto-renew" OR "your order" OR "you\'ve been charged" OR',
  '"trial ends" OR "will renew" OR "monthly plan" OR "annual plan")',
].join(" ");

const MONTHLY_RATES: Record<Cadence, number> = {
  weekly: 4.345,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  unknown: 0,
};

export async function runSubscriptionScanTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[sub-scan] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[sub-scan] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: ScanArgs = task.args ?? {};
  const notify = args.notify ?? true;
  const query = args.query ?? DEFAULT_QUERY;
  const max = Math.min(Math.max(args.max ?? 80, 10), 200);

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

  try {
    const email = await getEmailProvider(admin, task.user_id);
    await emit("progress", `scanning last 90d via ${email.providerName} (max ${max})`);
    const raw = await email.list({ query, max });
    const emails: EmailSummary[] = raw.map((e) => ({ ...e, body: e.body.slice(0, MAX_BODY_CHARS) }));
    await emit("progress", `fetched ${emails.length} email(s), extracting subscriptions…`);

    let emailExtracted: Extracted[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;

    if (emails.length > 0) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const systemPrompt = buildSystemPrompt();
      const userMsg = buildUserMessage(emails);

      let model = MODEL;
      let modelSwitched = false;
      let response: Anthropic.Messages.Message | null = null;
      for (let attempt = 0; attempt < 2 && !response; attempt++) {
        try {
          response = await anthropic.messages.create({
            model,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: [{ role: "user", content: userMsg }],
          });
        } catch (e) {
          if (!modelSwitched && isOverloadedError(e)) {
            modelSwitched = true;
            model = FALLBACK_MODEL;
            await emit("progress", `model overloaded, switching to ${FALLBACK_MODEL}`);
            continue;
          }
          throw e;
        }
      }
      if (!response) throw new Error("no response from model");

      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;
      cacheRead = response.usage.cache_read_input_tokens ?? 0;

      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      emailExtracted = parseExtracted(text);
    }

    const bank = await detectRecurringFromBank(admin, task.user_id, emit);
    const merged = mergeExtractions(emailExtracted, bank.extracted);
    const persisted = await persistSubs(admin, task.user_id, merged);

    const result: SubscriptionScanResult = {
      scanned_emails: emails.length,
      scanned_transactions: bank.scanned,
      new_subs: persisted.newCount,
      updated_subs: persisted.updatedCount,
      skipped: persisted.skippedCount,
      monthly_total_gbp: persisted.monthlyTotalGbp,
      subs: persisted.subs,
    };

    await admin.from("subscription_scan_state").upsert({
      user_id: task.user_id,
      last_scan_at: new Date().toISOString(),
      last_scan_email_id: emails[0]?.id ?? null,
      subs_found: persisted.newCount + persisted.updatedCount,
      updated_at: new Date().toISOString(),
    });

    await finishTask(admin, taskId, result, inputTokens, outputTokens, cacheRead);

    if (notify) {
      await notifyDone(
        admin,
        task.user_id,
        taskId,
        args.title,
        persisted.newCount,
        persisted.monthlyTotalGbp,
        persisted.subs.length,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit("error", msg);
    await admin
      .from("tasks")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", taskId);
  }
}

async function finishTask(
  admin: SupabaseClient,
  taskId: string,
  result: SubscriptionScanResult,
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
): Promise<void> {
  const costUsd = estimateCost(inputTokens, outputTokens, cacheRead);
  const { error } = await admin
    .from("tasks")
    .update({
      status: "done",
      result: JSON.stringify(result),
      completed_at: new Date().toISOString(),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheRead,
      cost_usd: costUsd,
    })
    .eq("id", taskId);
  if (error) throw new Error(`failed to mark task done: ${error.message}`);
}

function buildSystemPrompt(): string {
  return [
    "You are JARVIS's subscription-extractor. You receive the user's recent receipt/",
    "renewal/invoice emails and extract every RECURRING CHARGE you can identify.",
    "",
    "You are looking for ongoing subscriptions the user pays for — Netflix, Spotify,",
    "SaaS tools, gym memberships, cloud storage, news subs, AI tools, etc. NOT one-off",
    "purchases (flights, Amazon orders, single-item shop receipts), NOT bills to the",
    "user's business customers, NOT donations, NOT marketing emails.",
    "",
    "For each recurring charge you find, extract:",
    "- service_name: canonical brand name (e.g. 'Netflix', 'Spotify', 'ChatGPT Plus').",
    "  Normalize capitalization. Don't include plan variants unless meaningful.",
    "- amount: numeric amount per billing cycle (null if not shown).",
    "- currency: ISO 4217 code (GBP, USD, EUR…) or null.",
    "- cadence: 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'unknown'.",
    "- next_renewal_date: ISO date YYYY-MM-DD if stated or inferable, else null.",
    "- status: 'active' (paying) | 'trial' (free trial) | 'cancelled' (user stopped) |",
    "  'paused' | 'unknown'. Default 'active' for a normal paid receipt.",
    "- category: short label ('entertainment', 'software', 'news', 'fitness', 'utilities',",
    "  'ai', 'cloud', 'other'). Best-guess, one word.",
    "- confidence: 0.0–1.0 — how sure are you this is a real recurring subscription?",
    "  < 0.5 probably a one-off, skip. 0.5–0.8 plausible, include. > 0.8 explicit.",
    "- source_email_id: the email id you based this on.",
    "- reasoning: one short sentence (for debugging).",
    "",
    "DEDUPLICATE across the batch. If Netflix appears in 3 monthly receipts, return ONE",
    "row with the latest info (most recent next_renewal_date, status).",
    "",
    "Output contract (STRICT — parsed):",
    "Return a single JSON object inside <subs>...</subs> tags:",
    "{",
    '  "subs": [',
    '    { "service_name": "...", "amount": 10.99, "currency": "GBP", "cadence": "monthly",',
    '      "next_renewal_date": "2026-05-15", "status": "active", "category": "entertainment",',
    '      "confidence": 0.95, "source_email_id": "<id>", "reasoning": "..." },',
    "    ...",
    "  ]",
    "}",
    "",
    "If you find no recurring charges, return {\"subs\": []}.",
    "Do not include one-off purchases. Do not guess. Do not wrap in markdown fences.",
  ].join("\n");
}

function buildUserMessage(emails: EmailSummary[]): string {
  const parts = [`Extract recurring subscriptions from these ${emails.length} emails.\n`];
  for (const e of emails) {
    parts.push(
      [
        `--- EMAIL ${e.id} ---`,
        `From: ${e.from}`,
        `Subject: ${e.subject}`,
        `Date: ${e.date}`,
        "",
        e.body || e.snippet || "(no body)",
        "",
      ].join("\n"),
    );
  }
  parts.push("Return the extracted subscriptions now, wrapped in <subs> tags.");
  return parts.join("\n");
}

function parseExtracted(text: string): Extracted[] {
  const match = text.match(/<subs>([\s\S]*?)<\/subs>/i);
  const jsonStr = match?.[1]?.trim() ?? text.trim();
  let parsed: { subs?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  const out: Extracted[] = [];
  for (const raw of parsed.subs ?? []) {
    const name = String(raw.service_name ?? "").trim();
    if (!name) continue;
    const confidence = clamp01(Number(raw.confidence ?? 0));
    if (confidence < 0.5) continue;
    out.push({
      service_name: name,
      amount: raw.amount == null ? null : Number(raw.amount),
      currency: raw.currency ? String(raw.currency).toUpperCase() : null,
      cadence: normalizeCadence(String(raw.cadence ?? "unknown")),
      next_renewal_date: raw.next_renewal_date ? String(raw.next_renewal_date) : null,
      status: normalizeStatus(String(raw.status ?? "active")),
      category: raw.category ? String(raw.category) : null,
      confidence,
      source: "email",
      source_email_id: raw.source_email_id ? String(raw.source_email_id) : null,
      last_charged_at: null,
      reasoning: String(raw.reasoning ?? ""),
    });
  }
  return out;
}

function normalizeCadence(s: string): Cadence {
  const v = s.toLowerCase().trim();
  if (v === "weekly" || v === "monthly" || v === "quarterly" || v === "annual") return v;
  if (v === "yearly") return "annual";
  return "unknown";
}

function normalizeStatus(s: string): Status {
  const v = s.toLowerCase().trim();
  if (v === "active" || v === "trial" || v === "cancelled" || v === "paused") return v;
  if (v === "canceled") return "cancelled";
  return "unknown";
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function dedupKey(serviceName: string, amount: number | null, cadence: Cadence): string {
  return `${serviceName.trim().toLowerCase()}|${amount ?? "null"}|${cadence}`;
}

async function persistSubs(
  admin: SupabaseClient,
  userId: string,
  extracted: Extracted[],
): Promise<{
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  monthlyTotalGbp: number;
  subs: SubscriptionScanResult["subs"];
}> {
  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const resultSubs: SubscriptionScanResult["subs"] = [];
  let monthlyTotalGbp = 0;

  for (const s of extracted) {
    const key = dedupKey(s.service_name, s.amount, s.cadence);
    const now = new Date().toISOString();

    const { data: existing } = await admin
      .from("subscriptions")
      .select("id, source_email_ids, detection_source, first_seen_at, status, user_confirmed, last_charged_at")
      .eq("user_id", userId)
      .eq("dedup_key", key)
      .maybeSingle();

    const newSourceLabel = s.source === "bank" ? "bank_scan" : "email_scan";

    let isNew = false;
    let finalDetectionSource = newSourceLabel;
    if (existing) {
      const existingIds = Array.isArray(existing.source_email_ids) ? existing.source_email_ids : [];
      const mergedIds = s.source_email_id
        ? Array.from(new Set([...existingIds.map(String), s.source_email_id]))
        : existingIds.map(String);
      const prevSource = String(existing.detection_source ?? "email_scan");
      finalDetectionSource =
        prevSource === "both" || (prevSource !== newSourceLabel && prevSource !== "unknown")
          ? "both"
          : newSourceLabel;
      const lastCharged = pickLaterIso(existing.last_charged_at as string | null, s.last_charged_at);
      const { error: updErr } = await admin
        .from("subscriptions")
        .update({
          service_name: s.service_name,
          amount: s.amount,
          currency: s.currency ?? "GBP",
          cadence: s.cadence,
          next_renewal_date: s.next_renewal_date,
          status: existing.user_confirmed ? existing.status : s.status,
          category: s.category,
          confidence: s.confidence,
          source_email_ids: mergedIds,
          detection_source: finalDetectionSource,
          last_charged_at: lastCharged,
          last_seen_at: now,
          updated_at: now,
        })
        .eq("id", existing.id);
      if (updErr) {
        skippedCount++;
        continue;
      }
      updatedCount++;
    } else {
      const { error: insErr } = await admin.from("subscriptions").insert({
        user_id: userId,
        service_name: s.service_name,
        dedup_key: key,
        amount: s.amount,
        currency: s.currency ?? "GBP",
        cadence: s.cadence,
        next_renewal_date: s.next_renewal_date,
        status: s.status,
        category: s.category,
        confidence: s.confidence,
        detection_source: newSourceLabel,
        source_email_ids: s.source_email_id ? [s.source_email_id] : [],
        last_charged_at: s.last_charged_at,
        first_seen_at: now,
        last_seen_at: now,
      });
      if (insErr) {
        skippedCount++;
        continue;
      }
      newCount++;
      isNew = true;
    }

    resultSubs.push({
      service_name: s.service_name,
      amount: s.amount,
      currency: s.currency ?? "GBP",
      cadence: s.cadence,
      status: s.status,
      next_renewal_date: s.next_renewal_date,
      detection_source: finalDetectionSource,
      is_new: isNew,
    });

    if (s.amount != null && s.status !== "cancelled") {
      // Rough GBP conversion for non-GBP: treat as parity for now; later fetch FX.
      monthlyTotalGbp += s.amount * MONTHLY_RATES[s.cadence];
    }
  }

  return {
    newCount,
    updatedCount,
    skippedCount,
    monthlyTotalGbp: Math.round(monthlyTotalGbp * 100) / 100,
    subs: resultSubs,
  };
}

async function notifyDone(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  title: string | undefined,
  newCount: number,
  monthlyTotalGbp: number,
  totalSubs: number,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return;

  const label = title ? `"${title}"` : "Subscription scan";
  const body = newCount === 0 && totalSubs === 0
    ? `🧾 ${label}: no subscriptions detected yet. Try again after more receipt emails land.`
    : newCount === 0
    ? `🧾 ${label}: checked — you're on £${monthlyTotalGbp.toFixed(0)}/mo across ${totalSubs} subs. No new ones found.`
    : `🧾 ${label}: found ${newCount} new sub${newCount === 1 ? "" : "s"}. You're on £${monthlyTotalGbp.toFixed(0)}/mo across ${totalSubs} total. Say "show subs" for the list.`;

  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
      task_id: taskId,
    })
    .select("id")
    .single();
  if (error || !notif) return;

  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[sub-scan] dispatch failed:", e);
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

function pickLaterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() > new Date(b).getTime() ? a : b;
}

// Bank-side recurring-charge detection. No LLM — deterministic grouping by
// normalized merchant + signed amount over the last 90 days. Complements the
// email scan: catches Apple/Google Pay subs, direct debits, and anything the
// provider never emailed a receipt for. If banking isn't connected, returns
// empty — the user just won't see bank-source rows until they link a bank.
async function detectRecurringFromBank(
  admin: SupabaseClient,
  userId: string,
  emit: (kind: "text" | "progress" | "error", content: string | null) => Promise<void>,
): Promise<{ extracted: Extracted[]; scanned: number }> {
  let provider;
  try {
    provider = await getBankingProvider(admin, userId);
  } catch {
    // No banking integration connected — skip silently.
    return { extracted: [], scanned: 0 };
  }

  let txns: Transaction[];
  try {
    txns = await provider.listTransactions({ range: "last_90d", limit: 500 });
  } catch (e) {
    await emit("progress", `bank scan skipped: ${e instanceof Error ? e.message : String(e)}`);
    return { extracted: [], scanned: 0 };
  }

  await emit("progress", `scanning ${txns.length} ${provider.providerName} transaction(s) for recurring charges…`);

  // Only spending (negative signed amounts), not transfers, not pending.
  const spend = txns.filter((t) => t.amount_minor < 0 && !t.is_transfer && !t.is_pending);

  // Group by (normalized merchant, abs(amount_minor), currency).
  const groups = new Map<string, { merchantRaw: string; amountMinor: number; currency: string; dates: string[]; categories: string[] }>();
  for (const t of spend) {
    const merchantRaw = (t.merchant ?? t.description ?? "").trim();
    if (!merchantRaw) continue;
    const normalized = normalizeMerchant(merchantRaw);
    if (!normalized) continue;
    const absMinor = Math.abs(t.amount_minor);
    // Skip tiny one-off charges; sub cutoff £1.00.
    if (absMinor < 100) continue;
    const key = `${normalized.toLowerCase()}|${absMinor}|${t.currency}`;
    const g = groups.get(key);
    if (g) {
      g.dates.push(t.created);
      if (t.category) g.categories.push(t.category);
    } else {
      groups.set(key, {
        merchantRaw: normalized,
        amountMinor: absMinor,
        currency: t.currency,
        dates: [t.created],
        categories: t.category ? [t.category] : [],
      });
    }
  }

  const out: Extracted[] = [];
  for (const g of groups.values()) {
    if (g.dates.length < 2) continue;
    const sorted = g.dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
    const intervalsDays: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervalsDays.push((sorted[i]! - sorted[i - 1]!) / (1000 * 60 * 60 * 24));
    }
    const median = medianOf(intervalsDays);
    const cadence = classifyCadence(median);
    if (!cadence) continue; // not a plausible sub cadence

    const confidence = sorted.length >= 3 ? 0.95 : 0.75;
    const last = new Date(sorted[sorted.length - 1]!);
    const next = nextRenewalFrom(last, cadence);

    out.push({
      service_name: g.merchantRaw,
      amount: g.amountMinor / 100,
      currency: g.currency,
      cadence,
      next_renewal_date: next ? next.toISOString().slice(0, 10) : null,
      status: "active",
      category: pickMostCommon(g.categories),
      confidence,
      source: "bank",
      source_email_id: null,
      last_charged_at: last.toISOString(),
      reasoning: `${sorted.length} charges, median interval ${median.toFixed(1)}d`,
    });
  }

  return { extracted: out, scanned: txns.length };
}

// Merge two lists of extracted subs into one, preferring the more-confident
// entry when the same (service|amount|cadence) is seen from both sides. Bank
// side fills in amount+cadence for email rows missing them.
function mergeExtractions(email: Extracted[], bank: Extracted[]): Extracted[] {
  const byKey = new Map<string, Extracted>();
  for (const list of [email, bank]) {
    for (const e of list) {
      const key = dedupKey(e.service_name, e.amount, e.cadence);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, e);
      } else {
        byKey.set(key, e.confidence > prev.confidence ? e : prev);
      }
    }
  }
  return Array.from(byKey.values());
}

function normalizeMerchant(raw: string): string {
  let s = raw;
  // Strip trailing numeric IDs, "86796987 GB", "REF 1234", card masks.
  s = s.replace(/\b\d{3,}\b/g, " ");
  s = s.replace(/\b(GB|UK|US|EU|LTD|LIMITED|INC|LLC|CO|CORP|PLC|UK LIMITED)\b/gi, " ");
  s = s.replace(/[*_]/g, " ");
  s = s.replace(/\.com\b/gi, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return raw.trim();
  // Title case: first letter of each word uppercase, rest lowercase.
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function medianOf(ns: number[]): number {
  if (ns.length === 0) return 0;
  const sorted = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function classifyCadence(medianDays: number): Cadence | null {
  if (medianDays >= 5 && medianDays <= 9) return "weekly";
  if (medianDays >= 25 && medianDays <= 35) return "monthly";
  if (medianDays >= 80 && medianDays <= 100) return "quarterly";
  if (medianDays >= 340 && medianDays <= 400) return "annual";
  return null;
}

function nextRenewalFrom(last: Date, cadence: Cadence): Date | null {
  const d = new Date(last);
  switch (cadence) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      return d;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      return d;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      return d;
    case "annual":
      d.setFullYear(d.getFullYear() + 1);
      return d;
    default:
      return null;
  }
}

function pickMostCommon(xs: string[]): string | null {
  if (xs.length === 0) return null;
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}
