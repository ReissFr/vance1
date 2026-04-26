// Brain-level payments tools. Read-only; back a "payment provider" (Stripe
// today, Paddle/LemonSqueezy pluggable) behind the @jarvis/integrations
// resolver. Destructive operations (refund, cancel subscription) will be
// added later and MUST route through the needs_approval task flow — never
// execute directly from a brain-level tool call.

import { z } from "zod";
import { getPaymentProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const RANGE_ENUM = [
  "today",
  "yesterday",
  "week",
  "month",
  "mtd",
  "last_30d",
  "last_90d",
  "year",
  "ytd",
  "all_time",
] as const;

const PAYMENT_PROVIDERS = ["stripe", "paypal", "square"] as const;

export const paymentsRevenueTool = defineTool({
  name: "payments_revenue",
  description:
    "Summarize payment revenue for a time range. Returns gross + net (after refunds) per currency, plus charge/refund counts. Use for questions like 'how much did we make this month' or 'revenue today'. Pass `provider` to target a specific connection when the user has more than one payment provider connected.",
  schema: z.object({
    range: z.enum(RANGE_ENUM).optional(),
    provider: z.enum(PAYMENT_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      range: {
        type: "string",
        enum: [...RANGE_ENUM],
        description:
          "Time range: 'today', 'yesterday', 'week' (this week), 'mtd'/'month' (month to date), 'last_30d', 'last_90d', 'year' (last 365d), 'ytd' (year to date), 'all_time'. Defaults to 'mtd'.",
      },
      provider: {
        type: "string",
        enum: [...PAYMENT_PROVIDERS],
        description: "Which connected payment provider to query. Omit to use the user's default.",
      },
    },
  },
  async run(input, ctx) {
    const payments = await getPaymentProvider(ctx.supabase, ctx.userId, input.provider);
    const range = input.range ?? "mtd";
    return {
      provider: payments.providerName,
      summaries: await payments.listRevenue(range),
    };
  },
});

export const paymentsCustomersTool = defineTool({
  name: "payments_customers",
  description:
    "List recent customers from the payment provider. Use for 'who signed up recently' or 'list my last 10 customers'. Returns id, email, name, creation time.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    since_days: z.number().int().min(1).max(365).optional(),
    provider: z.enum(PAYMENT_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      since_days: {
        type: "number",
        description: "Only customers created in the last N days (1–365). Omit for any time.",
      },
      provider: {
        type: "string",
        enum: [...PAYMENT_PROVIDERS],
        description: "Which connected payment provider to query. Omit to use the default.",
      },
    },
  },
  async run(input, ctx) {
    const payments = await getPaymentProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: payments.providerName,
      customers: await payments.listCustomers({
        limit: input.limit ?? 20,
        sinceDays: input.since_days,
      }),
    };
  },
});

export const paymentsChargesTool = defineTool({
  name: "payments_charges",
  description:
    "List recent charges from the payment provider. Use for 'show me recent payments', 'any failed charges this week', 'list refunds'. Optionally filter by status.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    since_days: z.number().int().min(1).max(365).optional(),
    status: z.enum(["succeeded", "failed", "pending", "refunded"]).optional(),
    provider: z.enum(PAYMENT_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      since_days: { type: "number", description: "Only charges in the last N days." },
      status: {
        type: "string",
        enum: ["succeeded", "failed", "pending", "refunded"],
        description: "Filter by charge status.",
      },
      provider: {
        type: "string",
        enum: [...PAYMENT_PROVIDERS],
        description: "Which connected payment provider to query. Omit to use the default.",
      },
    },
  },
  async run(input, ctx) {
    const payments = await getPaymentProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: payments.providerName,
      charges: await payments.listCharges({
        limit: input.limit ?? 20,
        sinceDays: input.since_days,
        status: input.status,
      }),
    };
  },
});

export const paymentsSubscriptionsTool = defineTool({
  name: "payments_subscriptions",
  description:
    "List subscriptions from the payment provider. Use 'status=canceled' to find churned customers, 'status=active' for MRR reasoning, 'status=past_due' for dunning. Without a status filter, returns all subscriptions.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    status: z
      .enum(["active", "trialing", "past_due", "canceled", "incomplete", "unpaid"])
      .optional(),
    provider: z.enum(PAYMENT_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      status: {
        type: "string",
        enum: ["active", "trialing", "past_due", "canceled", "incomplete", "unpaid"],
        description: "Filter by subscription status.",
      },
      provider: {
        type: "string",
        enum: [...PAYMENT_PROVIDERS],
        description: "Which connected payment provider to query. Omit to use the default.",
      },
    },
  },
  async run(input, ctx) {
    const payments = await getPaymentProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: payments.providerName,
      subscriptions: await payments.listSubscriptions({
        limit: input.limit ?? 20,
        status: input.status,
      }),
    };
  },
});
