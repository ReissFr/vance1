// Brain-level receipts tools. Read what we've already extracted in the
// `receipts` table, queue a fresh scan, or mark a receipt as confirmed.
// The scanner itself lives in apps/web/lib/receipts-scan.ts — these tools
// just enqueue and query.
//
// Disambiguation: receipts are ONE-OFF purchases (Amazon, Uber Eats, flights).
// For RECURRING charges use list_my_subscriptions / scan_my_subscriptions.

import { z } from "zod";
import { defineTool } from "./types";

export const listMyReceiptsTool = defineTool({
  name: "list_my_receipts",
  description: [
    "List the user's one-off purchase receipts — Amazon, Uber Eats, flights,",
    "shop orders, anything that isn't recurring. Returns merchants, amounts,",
    "categories, and a total by currency for the filtered set.",
    "",
    "Use for questions like: 'what did I buy this month?', 'show my Amazon orders',",
    "'how much did I spend on takeaway?', 'list my purchases'.",
    "",
    "For RECURRING charges use list_my_subscriptions instead. If the list looks",
    "incomplete, call scan_my_receipts for a fresh email sweep.",
  ].join("\n"),
  schema: z.object({
    category: z.string().optional(),
    archived: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description:
          "Filter by category (e.g. 'groceries', 'takeaway', 'electronics', 'travel').",
      },
      archived: {
        type: "boolean",
        description: "Include archived receipts. Default false (active only).",
      },
      limit: { type: "number", description: "Max rows. Default 150, max 500." },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 150;
    const archived = input.archived ?? false;

    let q = ctx.supabase
      .from("receipts")
      .select(
        "id, merchant, amount, currency, purchased_at, category, description, order_ref, confidence, archived",
      )
      .eq("user_id", ctx.userId)
      .eq("archived", archived)
      .order("purchased_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (input.category) q = q.eq("category", input.category);

    const { data, error } = await q;
    if (error) throw new Error(`Failed to load receipts: ${error.message}`);

    const rows = data ?? [];
    const totals: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      if (r.amount == null) continue;
      const cur = (r.currency as string) || "GBP";
      totals[cur] = (totals[cur] ?? 0) + Number(r.amount);
      const cat = (r.category as string) || "other";
      byCategory[cat] = (byCategory[cat] ?? 0) + Number(r.amount);
    }

    return {
      count: rows.length,
      totals_by_currency: Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [k, Math.round(v * 100) / 100]),
      ),
      spend_by_category: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, Math.round(v * 100) / 100]),
      ),
      receipts: rows,
    };
  },
});

export const scanMyReceiptsTool = defineTool({
  name: "scan_my_receipts",
  description: [
    "Queue a fresh sweep of the user's email for one-off purchase receipts.",
    "Scans the last 60 days, extracts merchant/amount/date/category, and",
    "populates the receipts table. Idempotent — same purchase won't duplicate.",
    "",
    "Runs server-side in the background. Respond with a short ack like",
    "'On it — sweeping your email for receipts, I'll ping you with the total.'",
    "",
    "Use when the user asks: 'what did I buy?', 'find my receipts', 'scan my",
    "purchases' AND the existing list looks stale or empty. For recurring",
    "subscriptions use scan_my_subscriptions instead.",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(1).max(120).optional(),
    query: z.string().max(400).optional(),
    max: z.number().int().min(10).max(150).optional(),
    notify: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short label for the Tasks panel." },
      query: {
        type: "string",
        description: "Override Gmail query. Default sweeps last 60d for receipts.",
      },
      max: { type: "number", description: "Cap on emails. Default 60, max 150." },
      notify: { type: "boolean", description: "WhatsApp ping when done. Default false." },
    },
  },
  async run(input, ctx) {
    const title = input.title ?? "Receipts scan";
    const notify = input.notify ?? false;

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "receipts_scan",
        prompt: "Scan email for one-off purchase receipts",
        args: { title, query: input.query, max: input.max, notify },
        device_target: "server",
        status: "queued",
      })
      .select("id, created_at")
      .single();

    if (error) throw new Error(`Failed to enqueue receipts scan: ${error.message}`);

    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-receipts-scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => {
      console.warn("[scan_my_receipts] trigger fetch failed:", e);
    });

    return {
      task_id: data.id,
      status: "queued",
      title,
      notify,
      message:
        "Receipts scan queued. Tell the user it's running and you'll ping them with a summary.",
    };
  },
});
