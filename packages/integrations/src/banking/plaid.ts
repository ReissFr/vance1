// PlaidProvider — BankingProvider backed by the Plaid REST API (global,
// US-primary, also covers UK/EU). Plaid's auth model is distinct from
// OAuth: the web UI uses Plaid Link to obtain a public_token, the server
// exchanges it for a permanent access_token, and that's stored here. No
// refresh flow — access_tokens are durable until Item is deleted.

import type {
  BankingProvider,
  Account,
  AccountType,
  Transaction,
  TxnRange,
  SpendingSummary,
  SpendingBucket,
} from "./provider";

export type PlaidEnv = "sandbox" | "development" | "production";

const HOSTS: Record<PlaidEnv, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

export type PlaidCredentials = {
  access_token?: string | null;
  item_id?: string | null;
  institution_id?: string | null;
  institution_name?: string | null;
};

export type PlaidProviderOptions = {
  credentials: PlaidCredentials;
  env: PlaidEnv;
  clientId: string;
  secret: string;
};

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name?: string;
  type: string;
  subtype?: string;
  balances: { available?: number | null; current?: number | null; iso_currency_code?: string | null };
};

type PlaidTxn = {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  name: string;
  merchant_name?: string | null;
  category?: string[] | null;
  pending: boolean;
};

export class PlaidProvider implements BankingProvider {
  readonly providerName = "plaid";
  private readonly accessToken: string;
  private readonly host: string;
  private readonly clientId: string;
  private readonly secret: string;

  constructor(opts: PlaidProviderOptions) {
    const t = opts.credentials.access_token;
    if (!t) throw new Error("PlaidProvider: no access_token in credentials");
    this.accessToken = t;
    this.host = HOSTS[opts.env];
    this.clientId = opts.clientId;
    this.secret = opts.secret;
  }

  async listAccounts(): Promise<Account[]> {
    const data = await this.fetch<{ accounts: PlaidAccount[] }>("/accounts/get", {});
    return data.accounts.map((a) => ({
      id: a.account_id,
      name: a.official_name ?? a.name,
      type: mapType(a.type, a.subtype),
      currency: a.balances.iso_currency_code ?? "USD",
      balance_minor: toMinor(a.balances.current ?? 0),
      available_minor:
        a.balances.available != null ? toMinor(a.balances.available) : undefined,
    }));
  }

  async listTransactions(opts: {
    account_id?: string;
    range?: TxnRange;
    limit?: number;
    merchant_contains?: string;
    category?: string;
  }): Promise<Transaction[]> {
    const { from, to } = rangeToDates(opts.range ?? "last_30d");
    const data = await this.fetch<{ transactions: PlaidTxn[] }>("/transactions/get", {
      start_date: from.slice(0, 10),
      end_date: to.slice(0, 10),
      options: {
        account_ids: opts.account_id ? [opts.account_id] : undefined,
        count: Math.max(1, Math.min(500, opts.limit ?? 250)),
      },
    });

    let txns = data.transactions.map((t): Transaction => ({
      id: t.transaction_id,
      account_id: t.account_id,
      // Plaid returns positive for spend, negative for income — invert.
      amount_minor: toMinor(-t.amount),
      currency: t.iso_currency_code ?? "USD",
      created: t.date,
      description: t.name,
      merchant: t.merchant_name ?? null,
      category: (t.category ?? [])[0] ?? null,
      is_transfer: (t.category ?? []).includes("Transfer"),
      is_pending: t.pending,
    }));
    if (opts.merchant_contains) {
      const needle = opts.merchant_contains.toLowerCase();
      txns = txns.filter(
        (t) =>
          (t.merchant ?? "").toLowerCase().includes(needle) ||
          t.description.toLowerCase().includes(needle),
      );
    }
    if (opts.category) {
      const needle = opts.category.toLowerCase();
      txns = txns.filter((t) => (t.category ?? "").toLowerCase() === needle);
    }
    return txns;
  }

  async getSpending(opts: {
    range: TxnRange;
    account_id?: string;
  }): Promise<SpendingSummary[]> {
    const txns = await this.listTransactions({ range: opts.range, account_id: opts.account_id, limit: 500 });
    const byCurrency = new Map<string, Transaction[]>();
    for (const t of txns) {
      if (t.is_transfer) continue;
      if (!byCurrency.has(t.currency)) byCurrency.set(t.currency, []);
      byCurrency.get(t.currency)!.push(t);
    }
    const { from, to } = rangeToDates(opts.range);
    const summaries: SpendingSummary[] = [];
    for (const [currency, list] of byCurrency.entries()) {
      const buckets = new Map<string, SpendingBucket>();
      let totalSpend = 0;
      let totalIncome = 0;
      for (const t of list) {
        if (t.amount_minor < 0) totalSpend += -t.amount_minor;
        else totalIncome += t.amount_minor;
        const cat = t.category ?? "Other";
        if (!buckets.has(cat)) {
          buckets.set(cat, {
            category: cat,
            currency,
            spend_minor: 0,
            income_minor: 0,
            txn_count: 0,
          });
        }
        const b = buckets.get(cat)!;
        if (t.amount_minor < 0) b.spend_minor += -t.amount_minor;
        else b.income_minor += t.amount_minor;
        b.txn_count += 1;
      }
      summaries.push({
        range: opts.range,
        from,
        to,
        currency,
        total_spend_minor: totalSpend,
        total_income_minor: totalIncome,
        net_minor: totalIncome - totalSpend,
        buckets: [...buckets.values()].sort(
          (a, b) => b.spend_minor - a.spend_minor,
        ),
      });
    }
    return summaries;
  }

  private async fetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.host}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        secret: this.secret,
        access_token: this.accessToken,
        ...body,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Plaid ${path} ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }
}

function toMinor(n: number): number {
  return Math.round(n * 100);
}

function mapType(t: string, sub?: string): AccountType {
  if (t === "credit") return "credit";
  if (t === "loan") return "loan";
  if (t === "depository" && sub === "savings") return "savings";
  if (t === "depository") return "current";
  return "other";
}

function rangeToDates(range: TxnRange): { from: string; to: string } {
  const now = new Date();
  const toISO = (d: Date) => d.toISOString();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  };
  const daysAgo = (n: number) => {
    const x = startOfDay(now);
    x.setUTCDate(x.getUTCDate() - n);
    return x;
  };
  switch (range) {
    case "today":
      return { from: toISO(startOfDay(now)), to: toISO(now) };
    case "yesterday": {
      const y = daysAgo(1);
      const end = new Date(y);
      end.setUTCHours(23, 59, 59, 999);
      return { from: toISO(y), to: toISO(end) };
    }
    case "week":
    case "last_7d":
      return { from: toISO(daysAgo(7)), to: toISO(now) };
    case "last_30d":
    case "month":
      return { from: toISO(daysAgo(30)), to: toISO(now) };
    case "mtd": {
      const x = startOfDay(now);
      x.setUTCDate(1);
      return { from: toISO(x), to: toISO(now) };
    }
    case "last_90d":
      return { from: toISO(daysAgo(90)), to: toISO(now) };
    case "ytd": {
      const x = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from: toISO(x), to: toISO(now) };
    }
    case "all_time":
      return { from: "2015-01-01T00:00:00.000Z", to: toISO(now) };
  }
}
