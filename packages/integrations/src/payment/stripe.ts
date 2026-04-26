// StripeProvider — PaymentProvider implementation backed by Stripe's REST API
// via the `stripe` npm package.
//
// Uses a restricted API key (rk_live_... / rk_test_...) stored in the
// integrations.credentials jsonb. Recommended scopes for read-only use:
//   Charges: read, Customers: read, Subscriptions: read, Products: read.

import Stripe from "stripe";
import type {
  PaymentProvider,
  RevenueRange,
  RevenueSummary,
  Customer,
  Charge,
  ChargeStatus,
  Subscription,
  SubscriptionStatus,
} from "./provider";

export type StripeCredentials = {
  api_key?: string | null;
};

export type StripeProviderOptions = {
  credentials: StripeCredentials;
};

export class StripeProvider implements PaymentProvider {
  readonly providerName = "stripe";

  private readonly stripe: Stripe;

  constructor(opts: StripeProviderOptions) {
    const apiKey = opts.credentials.api_key;
    if (!apiKey) {
      throw new Error("Stripe integration missing credentials.api_key");
    }
    this.stripe = new Stripe(apiKey, { apiVersion: "2025-02-24.acacia" });
  }

  async listRevenue(range: RevenueRange): Promise<RevenueSummary[]> {
    const { from, to } = resolveRange(range);
    const gteSec = Math.floor(from.getTime() / 1000);
    const lteSec = Math.floor(to.getTime() / 1000);

    // Aggregate per-currency. We page through charges in the window and sum.
    // For accounts with huge volume this should move to balance transactions,
    // but for a solo founder's MRR it's fine.
    const perCurrency = new Map<string, { gross: number; refunded: number; charges: number; refunds: number }>();

    for await (const ch of this.stripe.charges.list({
      created: { gte: gteSec, lte: lteSec },
      limit: 100,
    })) {
      const cur = ch.currency;
      const bucket = perCurrency.get(cur) ?? { gross: 0, refunded: 0, charges: 0, refunds: 0 };
      if (ch.status === "succeeded") {
        bucket.gross += ch.amount;
        bucket.charges += 1;
        if (ch.amount_refunded > 0) {
          bucket.refunded += ch.amount_refunded;
          bucket.refunds += 1;
        }
      }
      perCurrency.set(cur, bucket);
    }

    return [...perCurrency.entries()].map(([currency, b]) => ({
      currency,
      gross_cents: b.gross,
      net_cents: b.gross - b.refunded,
      charge_count: b.charges,
      refund_count: b.refunds,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
    }));
  }

  async listCustomers(opts: { limit: number; sinceDays?: number }): Promise<Customer[]> {
    const params: Stripe.CustomerListParams = { limit: opts.limit };
    if (opts.sinceDays !== undefined) {
      params.created = { gte: Math.floor((Date.now() - opts.sinceDays * 86_400_000) / 1000) };
    }
    const res = await this.stripe.customers.list(params);
    return res.data.map((c) => ({
      id: c.id,
      email: c.email ?? null,
      name: c.name ?? null,
      created: new Date(c.created * 1000).toISOString(),
      total_spend_cents: null,
    }));
  }

  async listCharges(opts: {
    limit: number;
    sinceDays?: number;
    status?: ChargeStatus;
  }): Promise<Charge[]> {
    const params: Stripe.ChargeListParams = { limit: opts.limit, expand: ["data.customer"] };
    if (opts.sinceDays !== undefined) {
      params.created = { gte: Math.floor((Date.now() - opts.sinceDays * 86_400_000) / 1000) };
    }
    const res = await this.stripe.charges.list(params);
    const mapped: Charge[] = res.data.map((ch) => {
      const cust = typeof ch.customer === "object" && ch.customer && !("deleted" in ch.customer) ? ch.customer : null;
      return {
        id: ch.id,
        customer_id: typeof ch.customer === "string" ? ch.customer : cust?.id ?? null,
        customer_email: cust?.email ?? ch.billing_details?.email ?? null,
        amount_cents: ch.amount,
        currency: ch.currency,
        status: normalizeChargeStatus(ch),
        created: new Date(ch.created * 1000).toISOString(),
        description: ch.description,
      };
    });
    return opts.status ? mapped.filter((c) => c.status === opts.status) : mapped;
  }

  async listSubscriptions(opts: {
    limit: number;
    status?: SubscriptionStatus;
  }): Promise<Subscription[]> {
    const params: Stripe.SubscriptionListParams = {
      limit: opts.limit,
      expand: ["data.customer", "data.items.data.price.product"],
    };
    if (opts.status) {
      params.status = opts.status as Stripe.SubscriptionListParams.Status;
    } else {
      params.status = "all";
    }
    const res = await this.stripe.subscriptions.list(params);
    return res.data.map((sub) => {
      const cust =
        typeof sub.customer === "object" && sub.customer && !("deleted" in sub.customer) ? sub.customer : null;
      const item = sub.items.data[0];
      const price = item?.price;
      const product =
        price && typeof price.product === "object" && !("deleted" in price.product)
          ? (price.product as Stripe.Product)
          : null;
      return {
        id: sub.id,
        customer_id: typeof sub.customer === "string" ? sub.customer : cust?.id ?? "",
        customer_email: cust?.email ?? null,
        status: sub.status as SubscriptionStatus,
        product_name: product?.name ?? null,
        amount_cents: price?.unit_amount ?? null,
        currency: price?.currency ?? null,
        interval: (price?.recurring?.interval as Subscription["interval"]) ?? null,
        started: new Date(sub.start_date * 1000).toISOString(),
        canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
      };
    });
  }
}

function normalizeChargeStatus(ch: Stripe.Charge): ChargeStatus {
  if (ch.refunded || (ch.amount_refunded > 0 && ch.amount_refunded >= ch.amount)) {
    return "refunded";
  }
  if (ch.status === "succeeded") return "succeeded";
  if (ch.status === "failed") return "failed";
  return "pending";
}

function resolveRange(range: RevenueRange): { from: Date; to: Date } {
  const now = new Date();
  if (range === "yesterday") {
    const from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(0, 0, 0, 0);
    return { from, to };
  }
  const to = now;
  const from = new Date(now);
  switch (range) {
    case "today":
      from.setHours(0, 0, 0, 0);
      break;
    case "week": {
      const day = from.getDay() === 0 ? 6 : from.getDay() - 1;
      from.setDate(from.getDate() - day);
      from.setHours(0, 0, 0, 0);
      break;
    }
    case "month":
    case "mtd":
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
    case "last_30d":
      from.setDate(from.getDate() - 30);
      break;
    case "last_90d":
      from.setDate(from.getDate() - 90);
      break;
    case "year":
      from.setDate(from.getDate() - 365);
      break;
    case "ytd":
      from.setMonth(0, 1);
      from.setHours(0, 0, 0, 0);
      break;
    case "all_time":
      // Stripe accounts go back 2011; 20 years covers every real case.
      from.setFullYear(from.getFullYear() - 20);
      break;
  }
  return { from, to };
}
