// Brain-level subscription tools. Read what we've already detected in the
// user's `subscriptions` table, queue a fresh email scan, or let the user
// mark a sub as cancelled. The scanner itself lives in apps/web/lib/
// subscription-scan.ts — these tools just enqueue and query.
//
// Disambiguation: `payments_subscriptions` reports the user's own customers'
// subscriptions (Stripe as merchant). `list_my_subscriptions` below reports
// things the USER pays for (Netflix, gym, SaaS tools). Different concept.

import { z } from "zod";
import { defineTool } from "./types";

const MONTHLY_RATES: Record<string, number> = {
  weekly: 4.345,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  unknown: 0,
};

export const listMySubscriptionsTool = defineTool({
  name: "list_my_subscriptions",
  description: [
    "List the subscriptions the USER is currently paying for — Netflix, Spotify,",
    "SaaS tools, gym memberships, news subs, etc. Returns services, amounts, cadences,",
    "next renewal dates, and a rough monthly total in GBP.",
    "",
    "Use for questions like: 'what am I paying for?', 'show my subscriptions',",
    "'how much am I spending monthly?', 'list my subs'.",
    "",
    "Note: only subs JARVIS has DETECTED from the user's email show up here. If the",
    "list looks incomplete, call `scan_my_subscriptions` to do a fresh sweep.",
    "",
    "This is the USER's subscriptions (what they pay). For the user's own customer",
    "subscriptions (e.g. Stripe revenue), use `payments_subscriptions` instead.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "trial", "cancelled", "paused", "any"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["active", "trial", "cancelled", "paused", "any"],
        description: "Filter by status. Default 'active' (+trial) — currently costing money.",
      },
      limit: { type: "number", description: "Max rows. Default 100." },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 100;
    const statusFilter = input.status ?? "active";

    let q = ctx.supabase
      .from("subscriptions")
      .select("service_name, amount, currency, cadence, status, next_renewal_date, category, user_confirmed, first_seen_at, last_seen_at")
      .eq("user_id", ctx.userId)
      .order("amount", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (statusFilter === "active") {
      q = q.in("status", ["active", "trial"]);
    } else if (statusFilter !== "any") {
      q = q.eq("status", statusFilter);
    }

    const { data, error } = await q;
    if (error) throw new Error(`Failed to load subscriptions: ${error.message}`);

    const rows = data ?? [];
    let monthlyGbp = 0;
    const breakdownByCategory: Record<string, number> = {};
    for (const r of rows) {
      if (r.amount == null || r.status === "cancelled") continue;
      const rate = MONTHLY_RATES[r.cadence as string] ?? 0;
      const monthlyAmt = (Number(r.amount) || 0) * rate;
      monthlyGbp += monthlyAmt;
      const cat = (r.category as string) || "other";
      breakdownByCategory[cat] = (breakdownByCategory[cat] ?? 0) + monthlyAmt;
    }

    return {
      count: rows.length,
      monthly_total_gbp: Math.round(monthlyGbp * 100) / 100,
      annual_total_gbp: Math.round(monthlyGbp * 12 * 100) / 100,
      by_category: Object.fromEntries(
        Object.entries(breakdownByCategory).map(([k, v]) => [k, Math.round(v * 100) / 100]),
      ),
      subscriptions: rows,
    };
  },
});

export const scanMySubscriptionsTool = defineTool({
  name: "scan_my_subscriptions",
  description: [
    "Queue a fresh sweep for the user's recurring charges. Looks at BOTH the user's",
    "email (receipts, renewals, trial warnings) AND — if a bank account is linked —",
    "the last 90 days of transactions, grouping by merchant+amount to catch Apple/",
    "Google Pay subs and direct debits that never email a receipt.",
    "",
    "Runs server-side in the background; the user gets a WhatsApp ping when the sweep",
    "is done with a summary (new subs + monthly total).",
    "",
    "Use when the user asks: 'find my subscriptions', 'what am I paying for',",
    "'scan for subs' AND the existing list looks stale or empty.",
    "",
    "Does NOT return results inline — it queues a task. Respond with a short ack",
    "like 'On it — sweeping your email and bank, I'll ping you with the list.'",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(1).max(120).optional(),
    query: z.string().max(400).optional(),
    max: z.number().int().min(10).max(200).optional(),
    notify: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short label for the Tasks panel." },
      query: {
        type: "string",
        description: "Override Gmail query. Default sweeps last 90d for receipts/renewals.",
      },
      max: { type: "number", description: "Cap on emails to scan. Default 80, max 200." },
      notify: { type: "boolean", description: "WhatsApp ping when done. Default true." },
    },
  },
  async run(input, ctx) {
    const title = input.title ?? "Subscription scan";
    const notify = input.notify ?? true;

    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "subscription_scan",
        prompt: "Scan email for recurring subscriptions",
        args: {
          title,
          query: input.query,
          max: input.max,
          notify,
        },
        device_target: "server",
        status: "queued",
      })
      .select("id, created_at")
      .single();

    if (error) throw new Error(`Failed to enqueue subscription scan: ${error.message}`);

    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-subscription-scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => {
      console.warn("[scan_my_subscriptions] trigger fetch failed:", e);
    });

    return {
      task_id: data.id,
      status: "queued",
      title,
      notify,
      message:
        "Subscription scan queued. Tell the user it's running and you'll ping them with the list.",
    };
  },
});

export const markSubscriptionCancelledTool = defineTool({
  name: "mark_subscription_cancelled",
  description: [
    "Mark a subscription as cancelled when the user confirms they've stopped it.",
    "Updates the row so it's excluded from monthly totals and proactive trial alerts.",
    "",
    "Use when the user says: 'I cancelled Netflix', 'I stopped my Spotify sub',",
    "'remove Dropbox from my subs'. Match by service_name (case-insensitive, fuzzy OK).",
    "",
    "Does NOT actually cancel the subscription with the provider — it just records",
    "the user's statement. For actually cancelling, suggest opening the provider's",
    "billing page (or queue a browser agent task).",
  ].join("\n"),
  schema: z.object({
    service_name: z
      .string()
      .min(1)
      .describe("Service name as the user said it, e.g. 'Netflix', 'Spotify'."),
    notes: z.string().max(300).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      service_name: { type: "string", description: "Service name to cancel." },
      notes: { type: "string", description: "Optional note about why / how." },
    },
    required: ["service_name"],
  },
  async run(input, ctx) {
    // Case-insensitive match on service_name. If multiple rows (same service at
    // different price points), update the currently-active ones.
    const { data: matches, error: findErr } = await ctx.supabase
      .from("subscriptions")
      .select("id, service_name, status, amount, cadence")
      .eq("user_id", ctx.userId)
      .ilike("service_name", input.service_name)
      .in("status", ["active", "trial", "unknown"]);

    if (findErr) throw new Error(`Failed to lookup subscription: ${findErr.message}`);
    if (!matches || matches.length === 0) {
      return {
        ok: false,
        message: `No active subscription matching "${input.service_name}" found. Try list_my_subscriptions to see what's tracked.`,
      };
    }

    const now = new Date().toISOString();
    const ids = matches.map((m) => m.id);
    const { error: updErr } = await ctx.supabase
      .from("subscriptions")
      .update({
        status: "cancelled",
        user_confirmed: true,
        notes: input.notes ?? null,
        updated_at: now,
      })
      .in("id", ids);

    if (updErr) throw new Error(`Failed to mark cancelled: ${updErr.message}`);

    return {
      ok: true,
      cancelled: matches.map((m) => ({
        service_name: m.service_name,
        amount: m.amount,
        cadence: m.cadence,
      })),
      message: `Marked ${matches.length} sub${matches.length === 1 ? "" : "s"} as cancelled.`,
    };
  },
});
