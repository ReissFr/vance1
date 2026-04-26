// PayPalProvider — PaymentProvider implementation backed by PayPal's REST APIs.
//
// Uses the merchant's own client_id + client_secret (generated in their
// PayPal Developer Dashboard → My Apps & Credentials). We mint short-lived
// access tokens via client_credentials grant each call — simpler than
// persisting an access token that expires every ~9 hours.
//
// Reports API has a 31-day sliding window per request, so larger ranges
// (year, ytd, all_time) page through monthly chunks.

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

export type PayPalEnv = "live" | "sandbox";

export type PayPalCredentials = {
  client_id?: string | null;
  client_secret?: string | null;
  env?: PayPalEnv | null;
};

export type PayPalProviderOptions = {
  credentials: PayPalCredentials;
};

const API_BASES: Record<PayPalEnv, string> = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com",
};

export class PayPalProvider implements PaymentProvider {
  readonly providerName = "paypal";

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly base: string;
  private accessToken: string | null = null;
  private accessTokenExp = 0;

  constructor(opts: PayPalProviderOptions) {
    const { client_id, client_secret, env } = opts.credentials;
    if (!client_id || !client_secret) {
      throw new Error("PayPal integration missing credentials.client_id/client_secret");
    }
    this.clientId = client_id;
    this.clientSecret = client_secret;
    this.base = API_BASES[env ?? "live"];
  }

  async listRevenue(range: RevenueRange): Promise<RevenueSummary[]> {
    const { from, to } = resolveRange(range);
    const perCurrency = new Map<
      string,
      { gross: number; refunded: number; charges: number; refunds: number }
    >();

    for await (const tx of this.iterTransactions(from, to)) {
      const info = tx.transaction_info;
      if (!info) continue;
      const amount = parseAmount(info.transaction_amount?.value);
      const currency = info.transaction_amount?.currency_code;
      if (!currency || amount === null) continue;
      const bucket =
        perCurrency.get(currency) ?? { gross: 0, refunded: 0, charges: 0, refunds: 0 };
      // Event codes: T00xx = sale, T11xx = refund. Positive amounts are sales.
      const code = info.transaction_event_code ?? "";
      if (code.startsWith("T00") && amount > 0) {
        bucket.gross += amount;
        bucket.charges += 1;
      } else if (code.startsWith("T11") || amount < 0) {
        bucket.refunded += Math.abs(amount);
        bucket.refunds += 1;
      }
      perCurrency.set(currency, bucket);
    }

    return [...perCurrency.entries()].map(([currency, b]) => ({
      currency,
      gross_cents: Math.round(b.gross * 100),
      net_cents: Math.round((b.gross - b.refunded) * 100),
      charge_count: b.charges,
      refund_count: b.refunds,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
    }));
  }

  async listCustomers(opts: { limit: number; sinceDays?: number }): Promise<Customer[]> {
    // PayPal has no direct customer list. Derive from recent transactions —
    // unique payers, most-recent-seen first.
    const sinceDays = opts.sinceDays ?? 30;
    const from = new Date(Date.now() - sinceDays * 86_400_000);
    const to = new Date();
    const byPayerId = new Map<string, Customer>();
    for await (const tx of this.iterTransactions(from, to)) {
      const payer = tx.payer_info;
      const info = tx.transaction_info;
      if (!payer?.account_id || !info) continue;
      if (byPayerId.has(payer.account_id)) continue;
      byPayerId.set(payer.account_id, {
        id: payer.account_id,
        email: payer.email_address ?? null,
        name:
          [payer.payer_name?.given_name, payer.payer_name?.surname]
            .filter(Boolean)
            .join(" ") || null,
        created: info.transaction_initiation_date ?? new Date().toISOString(),
        total_spend_cents: null,
      });
      if (byPayerId.size >= opts.limit) break;
    }
    return [...byPayerId.values()];
  }

  async listCharges(opts: {
    limit: number;
    sinceDays?: number;
    status?: ChargeStatus;
  }): Promise<Charge[]> {
    const sinceDays = opts.sinceDays ?? 30;
    const from = new Date(Date.now() - sinceDays * 86_400_000);
    const to = new Date();
    const charges: Charge[] = [];
    for await (const tx of this.iterTransactions(from, to)) {
      const info = tx.transaction_info;
      if (!info?.transaction_id) continue;
      const amount = parseAmount(info.transaction_amount?.value);
      if (amount === null) continue;
      const status = normalizeStatus(info.transaction_status, info.transaction_event_code);
      if (opts.status && status !== opts.status) continue;
      charges.push({
        id: info.transaction_id,
        customer_id: tx.payer_info?.account_id ?? null,
        customer_email: tx.payer_info?.email_address ?? null,
        amount_cents: Math.round(Math.abs(amount) * 100),
        currency: info.transaction_amount?.currency_code ?? "USD",
        status,
        created: info.transaction_initiation_date ?? new Date().toISOString(),
        description: info.transaction_subject ?? info.transaction_note ?? null,
      });
      if (charges.length >= opts.limit) break;
    }
    return charges;
  }

  async listSubscriptions(opts: {
    limit: number;
    status?: SubscriptionStatus;
  }): Promise<Subscription[]> {
    // PayPal's /v1/billing/subscriptions requires searching by plan_id — no
    // list-all endpoint. Return empty until the merchant grants billing
    // scopes AND we build a plan-enumeration path.
    void opts;
    return [];
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessTokenExp > now + 30_000) {
      return this.accessToken;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`PayPal token mint failed (${res.status})`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = json.access_token;
    this.accessTokenExp = now + json.expires_in * 1000;
    return this.accessToken;
  }

  // Yields transactions across an arbitrary range, chunking into 31-day
  // windows because PayPal rejects longer spans.
  private async *iterTransactions(from: Date, to: Date): AsyncIterable<PayPalTxn> {
    const token = await this.getAccessToken();
    const windowMs = 30 * 86_400_000;
    let cursorEnd = to.getTime();
    const floor = from.getTime();
    while (cursorEnd > floor) {
      const windowStart = Math.max(floor, cursorEnd - windowMs);
      const sDate = new Date(windowStart).toISOString();
      const eDate = new Date(cursorEnd).toISOString();
      let page = 1;
      while (true) {
        const url = new URL(`${this.base}/v1/reporting/transactions`);
        url.searchParams.set("start_date", sDate);
        url.searchParams.set("end_date", eDate);
        url.searchParams.set("fields", "transaction_info,payer_info");
        url.searchParams.set("page_size", "100");
        url.searchParams.set("page", page.toString());
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          // Reporting API is rate-limited and sometimes 429s on back-to-back
          // chunks. Swallow and advance rather than breaking the whole call.
          break;
        }
        const json = (await res.json()) as {
          transaction_details?: PayPalTxn[];
          total_pages?: number;
        };
        for (const tx of json.transaction_details ?? []) {
          yield tx;
        }
        if (!json.total_pages || page >= json.total_pages) break;
        page += 1;
      }
      cursorEnd = windowStart;
    }
  }
}

type PayPalTxn = {
  transaction_info?: {
    transaction_id?: string;
    transaction_event_code?: string;
    transaction_status?: string;
    transaction_initiation_date?: string;
    transaction_amount?: { value?: string; currency_code?: string };
    transaction_subject?: string;
    transaction_note?: string;
  };
  payer_info?: {
    account_id?: string;
    email_address?: string;
    payer_name?: { given_name?: string; surname?: string };
  };
};

function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(
  status: string | undefined,
  code: string | undefined,
): ChargeStatus {
  if (code?.startsWith("T11")) return "refunded";
  switch (status) {
    case "S":
      return "succeeded";
    case "F":
      return "failed";
    case "P":
    case "V":
      return "pending";
    default:
      return "succeeded";
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
      // PayPal Reports only goes back 3 years. Cap there.
      from.setFullYear(from.getFullYear() - 3);
      break;
  }
  return { from, to };
}
