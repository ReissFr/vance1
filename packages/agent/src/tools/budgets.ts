// Brain-level budget tools. Read the user's monthly category budgets and
// their MTD spend status. The thresholds (80% warn, 100% breach) and the
// actual alerting live server-side in apps/web/lib/budget-check.ts.

import { z } from "zod";
import { defineTool } from "./types";

export const listMyBudgetsTool = defineTool({
  name: "list_my_budgets",
  description: [
    "List the user's monthly spending budgets by category with live month-to-",
    "date usage. Each row includes amount, spent, percent, and one of:",
    "  ok       — under 80%",
    "  warn     — between 80% and 100%",
    "  breach   — at or above 100%",
    "",
    "Spending is pulled from receipts, plus active subscriptions when the",
    "budget has include_subs=true. Use this for questions like",
    "'how am I doing on groceries?', 'am I over my takeaway budget?',",
    "'how much of my monthly food budget is left?'.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const { data: budgets, error } = await ctx.supabase
      .from("budgets")
      .select("id, category, amount, currency, include_subs, active")
      .eq("user_id", ctx.userId)
      .eq("active", true);
    if (error) throw new Error(`Failed to load budgets: ${error.message}`);
    const rows = budgets ?? [];
    if (rows.length === 0) {
      return {
        budgets: [],
        note: "No active budgets. Use set_my_budget to create one.",
      };
    }

    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const startIso = start.toISOString();

    const [{ data: receipts }, { data: subs }] = await Promise.all([
      ctx.supabase
        .from("receipts")
        .select("category, amount, currency, archived, purchased_at")
        .eq("user_id", ctx.userId)
        .gte("purchased_at", startIso),
      ctx.supabase
        .from("subscriptions")
        .select("category, amount, currency, status, cadence")
        .eq("user_id", ctx.userId),
    ]);

    const receiptsByCat: Record<string, Record<string, number>> = {};
    for (const r of (receipts ?? []) as Array<{
      category: string | null;
      amount: number | null;
      currency: string | null;
      archived: boolean;
    }>) {
      if (r.archived || !r.category || !r.amount) continue;
      const ccy = r.currency ?? "GBP";
      const bucket = receiptsByCat[r.category] ?? (receiptsByCat[r.category] = {});
      bucket[ccy] = (bucket[ccy] ?? 0) + Number(r.amount);
    }
    const subsByCat: Record<string, Record<string, number>> = {};
    for (const s of (subs ?? []) as Array<{
      category: string | null;
      amount: number | null;
      currency: string | null;
      status: string;
      cadence: string | null;
    }>) {
      if (s.status !== "active" && s.status !== "trial") continue;
      if (!s.category || !s.amount) continue;
      const monthly = monthlyEquiv(Number(s.amount), s.cadence);
      const ccy = s.currency ?? "GBP";
      const bucket = subsByCat[s.category] ?? (subsByCat[s.category] = {});
      bucket[ccy] = (bucket[ccy] ?? 0) + monthly;
    }

    return {
      budgets: rows.map((b) => {
        const spent =
          (receiptsByCat[b.category as string]?.[b.currency as string] ?? 0) +
          (b.include_subs
            ? subsByCat[b.category as string]?.[b.currency as string] ?? 0
            : 0);
        const amount = Number(b.amount);
        const percent = amount > 0 ? (spent / amount) * 100 : 0;
        const state = percent >= 100 ? "breach" : percent >= 80 ? "warn" : "ok";
        return {
          category: b.category,
          amount,
          currency: b.currency,
          include_subs: b.include_subs,
          spent: round2(spent),
          remaining: round2(amount - spent),
          percent: Math.round(percent * 10) / 10,
          state,
        };
      }),
      period_start: startIso.slice(0, 10),
    };
  },
});

export const setMyBudgetTool = defineTool({
  name: "set_my_budget",
  description: [
    "Create or update a monthly spending budget for a category. Upserts on",
    "(user, category, period=month) so calling this again with the same",
    "category just updates the amount.",
    "",
    "Use when the user says: 'set a £500/mo groceries budget', 'cap my",
    "takeaway at £150', 'I want to spend less on Amazon — make it £200/mo'.",
  ].join("\n"),
  schema: z.object({
    category: z.string().min(1).max(60),
    amount: z.number().positive(),
    currency: z.enum(["GBP", "USD", "EUR"]).optional(),
    include_subs: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string", enum: ["GBP", "USD", "EUR"] },
      include_subs: { type: "boolean" },
    },
    required: ["category", "amount"],
  },
  async run(input, ctx) {
    const { error } = await ctx.supabase.from("budgets").upsert(
      {
        user_id: ctx.userId,
        category: input.category.trim(),
        amount: input.amount,
        currency: input.currency ?? "GBP",
        include_subs: input.include_subs ?? true,
        period: "month",
        active: true,
      },
      { onConflict: "user_id,category,period" },
    );
    if (error) throw new Error(`Failed to set budget: ${error.message}`);
    return {
      ok: true,
      category: input.category,
      amount: input.amount,
      currency: input.currency ?? "GBP",
    };
  },
});

export const removeMyBudgetTool = defineTool({
  name: "remove_my_budget",
  description:
    "Remove a monthly budget by category name. Use when the user says 'stop tracking my groceries budget', 'remove my takeaway cap', etc.",
  schema: z.object({
    category: z.string().min(1).max(60),
  }),
  inputSchema: {
    type: "object",
    properties: { category: { type: "string" } },
    required: ["category"],
  },
  async run(input, ctx) {
    const { error } = await ctx.supabase
      .from("budgets")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("category", input.category.trim())
      .eq("period", "month");
    if (error) throw new Error(`Failed to remove budget: ${error.message}`);
    return { ok: true, category: input.category };
  },
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthlyEquiv(amount: number, cadence: string | null): number {
  switch ((cadence ?? "").toLowerCase()) {
    case "weekly":
      return amount * 4.33;
    case "fortnightly":
    case "biweekly":
      return amount * 2.17;
    case "quarterly":
      return amount / 3;
    case "yearly":
    case "annual":
      return amount / 12;
    default:
      return amount;
  }
}
