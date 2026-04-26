// Brain-level commerce tools — read-only access to the user's online store
// (Shopify today; BigCommerce/Woo pluggable via @jarvis/integrations).

import { z } from "zod";
import { getCommerceProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const ORDER_STATUSES = [
  "open",
  "fulfilled",
  "partially_fulfilled",
  "cancelled",
  "refunded",
] as const;

const SALES_RANGES = [
  "today",
  "yesterday",
  "week",
  "month",
  "mtd",
  "last_30d",
  "last_90d",
  "ytd",
  "all_time",
] as const;

export const commerceOrdersTool = defineTool({
  name: "commerce_orders",
  description:
    "List recent orders from the user's online store. Use for 'any orders today', 'show me unfulfilled orders', 'what's in my queue'. Filter by status if asked.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    since_days: z.number().int().min(1).max(365).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      since_days: { type: "number", description: "Only orders in the last N days." },
      status: {
        type: "string",
        enum: [...ORDER_STATUSES],
        description: "Filter by order status.",
      },
    },
  },
  async run(input, ctx) {
    const commerce = await getCommerceProvider(ctx.supabase, ctx.userId);
    return {
      provider: commerce.providerName,
      orders: await commerce.listOrders({
        limit: input.limit ?? 20,
        sinceDays: input.since_days,
        status: input.status,
      }),
    };
  },
});

export const commerceProductsTool = defineTool({
  name: "commerce_products",
  description:
    "List products from the online store. Use for 'what's in my catalog', 'show me draft products'. Filter by status if asked.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    status: z.enum(["active", "draft", "archived"]).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      status: {
        type: "string",
        enum: ["active", "draft", "archived"],
        description: "Filter by product status.",
      },
    },
  },
  async run(input, ctx) {
    const commerce = await getCommerceProvider(ctx.supabase, ctx.userId);
    return {
      provider: commerce.providerName,
      products: await commerce.listProducts({
        limit: input.limit ?? 20,
        status: input.status,
      }),
    };
  },
});

export const commerceLowStockTool = defineTool({
  name: "commerce_low_stock",
  description:
    "List products running low on inventory. Use for 'what's about to run out', 'low stock report'. Threshold defaults to 5 units.",
  schema: z.object({
    threshold: z.number().int().min(0).max(1000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      threshold: { type: "number", description: "Stock at or below this count is 'low'. Default 5." },
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
    },
  },
  async run(input, ctx) {
    const commerce = await getCommerceProvider(ctx.supabase, ctx.userId);
    return {
      provider: commerce.providerName,
      items: await commerce.listLowInventory({
        threshold: input.threshold ?? 5,
        limit: input.limit ?? 20,
      }),
    };
  },
});

export const commerceSalesTool = defineTool({
  name: "commerce_sales",
  description:
    "Summarize store sales for a time range (per currency). Use for 'how much did the shop do this week', 'sales today'.",
  schema: z.object({
    range: z.enum(SALES_RANGES).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      range: {
        type: "string",
        enum: [...SALES_RANGES],
        description: "Time range. Defaults to 'mtd'.",
      },
    },
  },
  async run(input, ctx) {
    const commerce = await getCommerceProvider(ctx.supabase, ctx.userId);
    return {
      provider: commerce.providerName,
      summaries: await commerce.listSales(input.range ?? "mtd"),
    };
  },
});
