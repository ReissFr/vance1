// Computes MTD spending per budget + category and fires WhatsApp alerts at
// the 80% and 100% thresholds. Idempotent: writes budget_alerts rows so the
// same threshold doesn't fire twice in the same month.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";

const WARN = 0.8;
const BREACH = 1.0;

export interface BudgetStatus {
  budget_id: string;
  category: string;
  amount: number;
  currency: string;
  spent: number;
  percent: number;
  state: "ok" | "warn" | "breach";
  period_start: string; // YYYY-MM-DD
  include_subs: boolean;
}

function periodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeBudgetStatuses(
  admin: SupabaseClient,
  userId: string,
): Promise<BudgetStatus[]> {
  const { data: budgets } = await admin
    .from("budgets")
    .select("id, category, amount, currency, include_subs")
    .eq("user_id", userId)
    .eq("active", true);

  const rows = (budgets ?? []) as Array<{
    id: string;
    category: string;
    amount: number;
    currency: string;
    include_subs: boolean;
  }>;
  if (rows.length === 0) return [];

  const start = periodStart();
  const startIso = start.toISOString();
  const startYmd = ymd(start);

  const [{ data: receipts }, { data: subs }] = await Promise.all([
    admin
      .from("receipts")
      .select("category, amount, currency, archived, purchased_at")
      .eq("user_id", userId)
      .gte("purchased_at", startIso),
    admin
      .from("subscriptions")
      .select("category, amount, currency, status, cadence")
      .eq("user_id", userId),
  ]);

  const receiptsByCategory: Record<string, Record<string, number>> = {};
  for (const r of (receipts ?? []) as Array<{
    category: string | null;
    amount: number | null;
    currency: string | null;
    archived: boolean;
  }>) {
    if (r.archived || !r.category || !r.amount) continue;
    const cat = r.category;
    const ccy = r.currency ?? "GBP";
    if (!receiptsByCategory[cat]) receiptsByCategory[cat] = {};
    const bucket = receiptsByCategory[cat];
    bucket[ccy] = (bucket[ccy] ?? 0) + Number(r.amount);
  }

  const subsByCategory: Record<string, Record<string, number>> = {};
  for (const s of (subs ?? []) as Array<{
    category: string | null;
    amount: number | null;
    currency: string | null;
    status: string;
    cadence: string | null;
  }>) {
    if (s.status !== "active" && s.status !== "trial") continue;
    if (!s.category || !s.amount) continue;
    const monthly = monthlyEquivalent(Number(s.amount), s.cadence);
    const ccy = s.currency ?? "GBP";
    const bucket =
      subsByCategory[s.category] ?? (subsByCategory[s.category] = {});
    bucket[ccy] = (bucket[ccy] ?? 0) + monthly;
  }

  return rows.map((b) => {
    const spent =
      (receiptsByCategory[b.category]?.[b.currency] ?? 0) +
      (b.include_subs ? subsByCategory[b.category]?.[b.currency] ?? 0 : 0);
    const percent = b.amount > 0 ? spent / Number(b.amount) : 0;
    const state: BudgetStatus["state"] =
      percent >= BREACH ? "breach" : percent >= WARN ? "warn" : "ok";
    return {
      budget_id: b.id,
      category: b.category,
      amount: Number(b.amount),
      currency: b.currency,
      spent: Number(spent.toFixed(2)),
      percent: Number((percent * 100).toFixed(1)),
      state,
      period_start: startYmd,
      include_subs: b.include_subs,
    };
  });
}

function monthlyEquivalent(amount: number, cadence: string | null): number {
  switch ((cadence ?? "").toLowerCase()) {
    case "weekly":
      return amount * 4.33;
    case "fortnightly":
    case "biweekly":
      return amount * 2.17;
    case "monthly":
    case "unknown":
      return amount;
    case "quarterly":
      return amount / 3;
    case "yearly":
    case "annual":
      return amount / 12;
    default:
      return amount;
  }
}

export async function runBudgetChecks(admin: SupabaseClient): Promise<{
  userCount: number;
  alertsFired: number;
}> {
  // Every user with at least one active budget.
  const { data: userRows } = await admin
    .from("budgets")
    .select("user_id")
    .eq("active", true);
  const userIds = [...new Set(((userRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))];

  let alertsFired = 0;
  for (const uid of userIds) {
    alertsFired += await checkOneUser(admin, uid);
  }
  return { userCount: userIds.length, alertsFired };
}

async function checkOneUser(admin: SupabaseClient, userId: string): Promise<number> {
  const statuses = await computeBudgetStatuses(admin, userId);
  const start = periodStart();
  const startYmd = ymd(start);

  let fired = 0;
  for (const s of statuses) {
    if (s.state === "ok") continue;
    const threshold = s.state === "breach" ? "breach" : "warn";

    // Dedup: is there already a row for this budget/period/threshold?
    const { data: existing } = await admin
      .from("budget_alerts")
      .select("id")
      .eq("budget_id", s.budget_id)
      .eq("period_start", startYmd)
      .eq("threshold", threshold)
      .maybeSingle();
    if (existing) continue;

    const { error: insertErr } = await admin.from("budget_alerts").insert({
      user_id: userId,
      budget_id: s.budget_id,
      period_start: startYmd,
      threshold,
      spent: s.spent,
      budget_amount: s.amount,
    });
    if (insertErr) continue;

    const headline =
      threshold === "breach"
        ? `Over budget: ${s.category}`
        : `Approaching ${s.category} budget`;
    const detail =
      threshold === "breach"
        ? `${money(s.spent, s.currency)} of ${money(s.amount, s.currency)} (${s.percent}%). Over by ${money(s.spent - s.amount, s.currency)}.`
        : `${s.percent}% used · ${money(s.spent, s.currency)} of ${money(s.amount, s.currency)}.`;
    const body = `${headline}\n${detail}`;

    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("mobile_e164")
        .eq("id", userId)
        .single();
      const toE164 = (profile as { mobile_e164: string | null } | null)?.mobile_e164;
      if (!toE164) continue;
      const { data: notif } = await admin
        .from("notifications")
        .insert({
          user_id: userId,
          channel: "whatsapp",
          to_e164: toE164,
          body,
          status: "queued",
        })
        .select("id")
        .single();
      if (notif?.id) {
        await dispatchNotification(admin, notif.id as string);
      }
      fired++;
    } catch {
      // Swallow — alert dedup row still written, so we won't retry this period.
    }
  }
  return fired;
}

function money(n: number, ccy: string): string {
  const sym = ccy === "GBP" ? "£" : ccy === "USD" ? "$" : ccy === "EUR" ? "€" : "";
  return sym ? `${sym}${n.toFixed(2)}` : `${n.toFixed(2)} ${ccy}`;
}
