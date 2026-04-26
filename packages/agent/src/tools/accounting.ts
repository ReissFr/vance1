// Brain-level accounting tools — read-only access to the user's bookkeeping.
// Any write operation (raise invoice, record expense, reconcile) goes through
// the task-approval flow, NOT directly from a brain tool.

import { z } from "zod";
import { getAccountingProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue", "void"] as const;
const ACCOUNTING_PROVIDERS = ["xero", "quickbooks", "freeagent"] as const;

export const accountingInvoicesTool = defineTool({
  name: "accounting_invoices",
  description:
    "List invoices from the accounting system. Use for 'any overdue invoices', 'unpaid invoices', 'show me this month's invoices'.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    status: z.enum(INVOICE_STATUSES).optional(),
    since_days: z.number().int().min(1).max(365).optional(),
    provider: z.enum(ACCOUNTING_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      status: {
        type: "string",
        enum: [...INVOICE_STATUSES],
        description: "Filter by invoice status.",
      },
      since_days: { type: "number", description: "Only invoices issued in the last N days." },
      provider: {
        type: "string",
        enum: [...ACCOUNTING_PROVIDERS],
        description: "Which accounting provider to query. Omit to use the default.",
      },
    },
  },
  async run(input, ctx) {
    const acc = await getAccountingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: acc.providerName,
      invoices: await acc.listInvoices({
        limit: input.limit ?? 20,
        status: input.status,
        sinceDays: input.since_days,
      }),
    };
  },
});

export const accountingExpensesTool = defineTool({
  name: "accounting_expenses",
  description:
    "List expenses (bills / purchases) from the accounting system. Use for 'what have I spent this month', 'recent bills'.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    since_days: z.number().int().min(1).max(365).optional(),
    provider: z.enum(ACCOUNTING_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      since_days: { type: "number", description: "Only expenses in the last N days." },
      provider: {
        type: "string",
        enum: [...ACCOUNTING_PROVIDERS],
        description: "Which accounting provider to query.",
      },
    },
  },
  async run(input, ctx) {
    const acc = await getAccountingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: acc.providerName,
      expenses: await acc.listExpenses({
        limit: input.limit ?? 20,
        sinceDays: input.since_days,
      }),
    };
  },
});

export const accountingBalancesTool = defineTool({
  name: "accounting_balances",
  description:
    "List account balances from the accounting system (bank, credit card, etc.). Use for 'what's my cash position', 'balance on my business account'.",
  schema: z.object({
    provider: z.enum(ACCOUNTING_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: [...ACCOUNTING_PROVIDERS],
        description: "Which accounting provider to query.",
      },
    },
  },
  async run(input, ctx) {
    const acc = await getAccountingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: acc.providerName,
      balances: await acc.listBalances(),
    };
  },
});

export const accountingContactsTool = defineTool({
  name: "accounting_contacts",
  description:
    "List contacts (customers / suppliers) from the accounting system. Use for 'who are my suppliers', 'list my customers'.",
  schema: z.object({
    limit: z.number().int().min(1).max(200).optional(),
    role: z.enum(["customer", "supplier"]).optional(),
    provider: z.enum(ACCOUNTING_PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–200. Default 50." },
      role: {
        type: "string",
        enum: ["customer", "supplier"],
        description: "Filter to customers or suppliers.",
      },
      provider: {
        type: "string",
        enum: [...ACCOUNTING_PROVIDERS],
        description: "Which accounting provider to query.",
      },
    },
  },
  async run(input, ctx) {
    const acc = await getAccountingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: acc.providerName,
      contacts: await acc.listContacts({
        limit: input.limit ?? 50,
        role: input.role,
      }),
    };
  },
});
