// Brain-level banking tools. Read-only; back a BankingProvider (Monzo today;
// TrueLayer/Plaid pluggable) behind the @jarvis/integrations resolver.
// Destructive ops (transfers, pot moves) will route through needs_approval —
// never executed directly here.

import { z } from "zod";
import { getBankingProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const RANGE_ENUM = [
  "today",
  "yesterday",
  "week",
  "month",
  "mtd",
  "last_7d",
  "last_30d",
  "last_90d",
  "ytd",
  "all_time",
] as const;

export const bankingAccountsTool = defineTool({
  name: "banking_accounts",
  description:
    "List the user's bank accounts, credit accounts, and savings pots with current balance. Amounts are in minor units (pence) with a currency code. Use for 'what's in my account', 'how much do I have', 'show me my pots'.",
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const bank = await getBankingProvider(ctx.supabase, ctx.userId);
    return {
      provider: bank.providerName,
      accounts: await bank.listAccounts(),
    };
  },
});

export const bankingTransactionsTool = defineTool({
  name: "banking_transactions",
  description:
    "List recent bank transactions, newest first. Amounts are minor units (pence), signed — negative = spend, positive = money in. Optional filters: merchant name substring, category, specific account. Use for 'what did I spend on Amazon', 'recent transactions', 'show me my coffee spending'.",
  schema: z.object({
    account_id: z.string().optional(),
    range: z.enum(RANGE_ENUM).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    merchant_contains: z.string().optional(),
    category: z.string().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      account_id: {
        type: "string",
        description: "Specific account id from banking_accounts. Omit for primary current account.",
      },
      range: {
        type: "string",
        enum: [...RANGE_ENUM],
        description: "Time range. Defaults to 'last_30d'.",
      },
      limit: { type: "number", description: "Max results, 1–100. Default 100." },
      merchant_contains: {
        type: "string",
        description: "Case-insensitive merchant/description substring filter (e.g. 'amazon').",
      },
      category: {
        type: "string",
        description:
          "Monzo category: groceries, eating_out, transport, bills, shopping, entertainment, holidays, personal_care, gifts, family, finances, charity, savings, income, transfers, general.",
      },
    },
  },
  async run(input, ctx) {
    const bank = await getBankingProvider(ctx.supabase, ctx.userId);
    return {
      provider: bank.providerName,
      transactions: await bank.listTransactions({
        account_id: input.account_id,
        range: input.range,
        limit: input.limit,
        merchant_contains: input.merchant_contains,
        category: input.category,
      }),
    };
  },
});

export const bankingSpendingTool = defineTool({
  name: "banking_spending",
  description:
    "Aggregate spending by category over a time range, split per currency. Returns total spend, income, net, and per-category buckets (sorted most-spent first). Excludes internal transfers. Use for 'how much did I spend this month', 'where's my money going', 'spending breakdown'. Amounts are minor units.",
  schema: z.object({
    range: z.enum(RANGE_ENUM).optional(),
    account_id: z.string().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      range: {
        type: "string",
        enum: [...RANGE_ENUM],
        description: "Time range. Defaults to 'mtd' (month-to-date).",
      },
      account_id: {
        type: "string",
        description: "Specific account id. Omit for primary current account.",
      },
    },
  },
  async run(input, ctx) {
    const bank = await getBankingProvider(ctx.supabase, ctx.userId);
    return {
      provider: bank.providerName,
      summaries: await bank.getSpending({
        range: input.range ?? "mtd",
        account_id: input.account_id,
      }),
    };
  },
});
