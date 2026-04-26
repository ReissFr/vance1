// SquareProvider — PaymentProvider implementation backed by the Square REST
// API using a merchant's personal access token.
//
// Simplest path for a solo merchant: generate an access token in Square's
// Developer Dashboard → Applications → Credentials (or switch to Sandbox
// mode there for testing). The token is long-lived and scoped to the
// application, so we do not need OAuth refresh flows for the MVP.

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

export type SquareEnv = "live" | "sandbox";

export type SquareCredentials = {
  access_token?: string | null;
  env?: SquareEnv | null;
};

export type SquareProviderOptions = {
  credentials: SquareCredentials;
};

const API_BASES: Record<SquareEnv, string> = {
  live: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

const API_VERSION = "2025-01-23";

export class SquareProvider implements PaymentProvider {
  readonly providerName = "square";

  private readonly token: string;
  private readonly base: string;

  constructor(opts: SquareProviderOptions) {
    if (!opts.credentials.access_token) {
      throw new Error("Square integration missing credentials.access_token");
    }
    this.token = opts.credentials.access_token;
    this.base = API_BASES[opts.credentials.env ?? "live"];
  }

  async listRevenue(range: RevenueRange): Promise<RevenueSummary[]> {
    const { from, to } = resolveRange(range);
    const perCurrency = new Map<
      string,
      { gross: number; refunded: number; charges: number; refunds: number }
    >();

    for await (const p of this.iterPayments({ from, to })) {
      const currency = p.amount_money?.currency ?? "USD";
      const bucket =
        perCurrency.get(currency) ?? { gross: 0, refunded: 0, charges: 0, refunds: 0 };
      if (p.status === "COMPLETED") {
        bucket.gross += p.amount_money?.amount ?? 0;
        bucket.charges += 1;
        if ((p.refunded_money?.amount ?? 0) > 0) {
          bucket.refunded += p.refunded_money?.amount ?? 0;
          bucket.refunds += 1;
        }
      }
      perCurrency.set(currency, bucket);
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
    const url = new URL(`${this.base}/v2/customers`);
    url.searchParams.set("sort_field", "CREATED_AT");
    url.searchParams.set("sort_order", "DESC");
    url.searchParams.set("limit", Math.min(opts.limit, 100).toString());
    const res = await this.get<{ customers?: SquareCustomer[] }>(url);
    const cutoff = opts.sinceDays
      ? Date.now() - opts.sinceDays * 86_400_000
      : null;
    return (res.customers ?? [])
      .filter((c) => {
        if (!cutoff || !c.created_at) return true;
        return new Date(c.created_at).getTime() >= cutoff;
      })
      .slice(0, opts.limit)
      .map((c) => ({
        id: c.id,
        email: c.email_address ?? null,
        name:
          [c.given_name, c.family_name].filter(Boolean).join(" ") ||
          c.company_name ||
          null,
        created: c.created_at ?? new Date().toISOString(),
        total_spend_cents: null,
      }));
  }

  async listCharges(opts: {
    limit: number;
    sinceDays?: number;
    status?: ChargeStatus;
  }): Promise<Charge[]> {
    const from = opts.sinceDays
      ? new Date(Date.now() - opts.sinceDays * 86_400_000)
      : new Date(Date.now() - 30 * 86_400_000);
    const to = new Date();
    const charges: Charge[] = [];
    for await (const p of this.iterPayments({ from, to })) {
      const status = normalizeStatus(p);
      if (opts.status && status !== opts.status) continue;
      charges.push({
        id: p.id,
        customer_id: p.customer_id ?? null,
        customer_email: p.buyer_email_address ?? null,
        amount_cents: p.amount_money?.amount ?? 0,
        currency: p.amount_money?.currency ?? "USD",
        status,
        created: p.created_at ?? new Date().toISOString(),
        description: p.note ?? null,
      });
      if (charges.length >= opts.limit) break;
    }
    return charges;
  }

  async listSubscriptions(opts: {
    limit: number;
    status?: SubscriptionStatus;
  }): Promise<Subscription[]> {
    const res = await this.post<{ subscriptions?: SquareSubscription[] }>(
      new URL(`${this.base}/v2/subscriptions/search`),
      {
        query: {
          filter: opts.status
            ? { source_names: [], customer_ids: [] }
            : undefined,
        },
        limit: Math.min(opts.limit, 100),
      },
    );
    const subs = res.subscriptions ?? [];
    const mapped: Subscription[] = subs.map((s) => ({
      id: s.id ?? "",
      customer_id: s.customer_id ?? "",
      customer_email: null,
      status: mapSubStatus(s.status),
      product_name: null,
      amount_cents: null,
      currency: null,
      interval: null,
      started: s.start_date ?? new Date().toISOString(),
      canceled_at: s.canceled_date ?? null,
    }));
    return opts.status ? mapped.filter((m) => m.status === opts.status) : mapped;
  }

  private async *iterPayments(opts: {
    from: Date;
    to: Date;
  }): AsyncIterable<SquarePayment> {
    let cursor: string | undefined;
    while (true) {
      const url = new URL(`${this.base}/v2/payments`);
      url.searchParams.set("begin_time", opts.from.toISOString());
      url.searchParams.set("end_time", opts.to.toISOString());
      url.searchParams.set("sort_order", "DESC");
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await this.get<{
        payments?: SquarePayment[];
        cursor?: string;
      }>(url);
      for (const p of res.payments ?? []) yield p;
      if (!res.cursor) break;
      cursor = res.cursor;
    }
  }

  private async get<T>(url: URL): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Square-Version": API_VERSION,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Square ${url.pathname} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private async post<T>(url: URL, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Square-Version": API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Square ${url.pathname} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

type SquarePayment = {
  id: string;
  status?: string;
  created_at?: string;
  customer_id?: string;
  buyer_email_address?: string;
  note?: string;
  amount_money?: { amount?: number; currency?: string };
  refunded_money?: { amount?: number; currency?: string };
};

type SquareCustomer = {
  id: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  created_at?: string;
};

type SquareSubscription = {
  id?: string;
  customer_id?: string;
  status?: string;
  start_date?: string;
  canceled_date?: string;
};

function normalizeStatus(p: SquarePayment): ChargeStatus {
  if ((p.refunded_money?.amount ?? 0) >= (p.amount_money?.amount ?? 0) && (p.amount_money?.amount ?? 0) > 0) {
    return "refunded";
  }
  switch (p.status) {
    case "COMPLETED":
      return "succeeded";
    case "FAILED":
    case "CANCELED":
      return "failed";
    case "APPROVED":
    case "PENDING":
      return "pending";
    default:
      return "succeeded";
  }
}

function mapSubStatus(s: string | undefined): SubscriptionStatus {
  switch (s) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
      return "past_due";
    case "CANCELED":
      return "canceled";
    case "DEACTIVATED":
      return "unpaid";
    case "PENDING":
      return "incomplete";
    default:
      return "active";
  }
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
      from.setFullYear(from.getFullYear() - 20);
      break;
  }
  return { from, to };
}
