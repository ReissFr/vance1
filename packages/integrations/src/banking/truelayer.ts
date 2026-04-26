// TrueLayerProvider — BankingProvider implementation backed by TrueLayer's
// Data API (https://docs.truelayer.com/reference/data-api). Fetch-based.
//
// TrueLayer is a UK/EU open-banking aggregator — one OAuth consent covers
// Revolut, Monzo, Starling, Barclays, HSBC, Lloyds, NatWest, Santander, etc.
//
// Auth: OAuth2 (confidential client). Stored credentials:
//   { access_token, refresh_token }  + expires_at on the integrations row.
// access_tokens live ~1h; refresh_tokens roll on every refresh. Under the
// hood TrueLayer proxies to each bank, re-consent by the user is required
// every 90 days (mandated by PSD2). Until then refreshes succeed silently.
//
// Note: amounts in TrueLayer are DECIMAL (e.g. 12.34). We multiply by 100
// and round to minor units to stay consistent with MonzoProvider.

import type {
  BankingProvider,
  Account,
  AccountType,
  Transaction,
  TxnRange,
  SpendingSummary,
  SpendingBucket,
} from "./provider";

const SKEW_MS = 60_000;

export type TrueLayerEnv = "live" | "sandbox";

export type TrueLayerCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
};

export type TrueLayerPersistFn = (updated: {
  credentials: TrueLayerCredentials;
  expires_at: string;
}) => Promise<void>;

export type TrueLayerProviderOptions = {
  credentials: TrueLayerCredentials;
  expiresAt: string | null;
  persist: TrueLayerPersistFn;
  clientId: string;
  clientSecret: string;
  env?: TrueLayerEnv;
};

type TLAccount = {
  account_id: string;
  account_type: string; // TRANSACTION, SAVINGS, CREDIT_CARD, BUSINESS_TRANSACTION...
  display_name: string;
  currency: string;
  provider: { provider_id: string; display_name: string };
  update_timestamp: string;
};

type TLBalance = {
  currency: string;
  available: number;
  current: number;
  update_timestamp: string;
};

type TLCard = {
  account_id: string;
  card_network: string;
  card_type: string;
  display_name: string;
  currency: string;
  provider: { provider_id: string; display_name: string };
};

type TLTransaction = {
  transaction_id: string;
  timestamp: string;
  description: string;
  amount: number;
  currency: string;
  transaction_type: "DEBIT" | "CREDIT";
  transaction_category: string; // PURCHASE, TRANSFER, ATM, BILL_PAYMENT, DIRECT_DEBIT, INTEREST, etc.
  transaction_classification: string[];
  merchant_name?: string | null;
  running_balance?: { amount: number; currency: string };
  meta?: Record<string, unknown>;
};

export class TrueLayerProvider implements BankingProvider {
  readonly providerName = "truelayer";

  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: string | null;
  private readonly persist: TrueLayerPersistFn;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiBase: string;
  private readonly authBase: string;

  constructor(opts: TrueLayerProviderOptions) {
    this.accessToken = opts.credentials.access_token ?? null;
    this.refreshToken = opts.credentials.refresh_token ?? null;
    this.expiresAt = opts.expiresAt;
    this.persist = opts.persist;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    const env = opts.env ?? "live";
    this.apiBase =
      env === "sandbox"
        ? "https://api.truelayer-sandbox.com"
        : "https://api.truelayer.com";
    this.authBase =
      env === "sandbox"
        ? "https://auth.truelayer-sandbox.com"
        : "https://auth.truelayer.com";
  }

  async listAccounts(): Promise<Account[]> {
    const [accountsRes, cardsRes] = await Promise.all([
      this.req<{ results: TLAccount[] }>(`/data/v1/accounts`),
      this.req<{ results: TLCard[] }>(`/data/v1/cards`).catch(() => ({
        results: [] as TLCard[],
      })),
    ]);

    const out: Account[] = [];

    // Transaction / savings / business accounts.
    await Promise.all(
      (accountsRes.results ?? []).map(async (a) => {
        const bal = await this.req<{ results: TLBalance[] }>(
          `/data/v1/accounts/${a.account_id}/balance`,
        ).catch(() => ({ results: [] as TLBalance[] }));
        const b = bal.results?.[0];
        out.push({
          id: a.account_id,
          name: `${a.display_name} (${a.provider.display_name})`,
          type: inferAccountType(a.account_type),
          currency: a.currency,
          balance_minor: toMinor(b?.current ?? 0),
          available_minor: b?.available != null ? toMinor(b.available) : undefined,
        });
      }),
    );

    // Credit cards.
    await Promise.all(
      (cardsRes.results ?? []).map(async (c) => {
        const bal = await this.req<{
          results: Array<{ current: number; available: number; currency: string }>;
        }>(`/data/v1/cards/${c.account_id}/balance`).catch(() => ({
          results: [] as Array<{ current: number; available: number; currency: string }>,
        }));
        const b = bal.results?.[0];
        out.push({
          id: c.account_id,
          name: `${c.display_name} (${c.provider.display_name})`,
          type: "credit",
          currency: c.currency,
          balance_minor: toMinor(b?.current ?? 0),
          available_minor: b?.available != null ? toMinor(b.available) : undefined,
        });
      }),
    );

    return out;
  }

  async listTransactions(opts: {
    account_id?: string;
    range?: TxnRange;
    limit?: number;
    merchant_contains?: string;
    category?: string;
  }): Promise<Transaction[]> {
    const { accountIds, cardIds } = await this.resolveAccountIds(opts.account_id);
    const { from, to } = resolveRange(opts.range ?? "last_30d");

    const all: Transaction[] = [];
    const fetchFor = async (id: string, kind: "accounts" | "cards") => {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const res = await this.req<{ results: TLTransaction[] }>(
        `/data/v1/${kind}/${id}/transactions?${params.toString()}`,
      ).catch(() => ({ results: [] as TLTransaction[] }));
      for (const t of res.results ?? []) all.push(toTxn(id, t));
    };
    await Promise.all([
      ...accountIds.map((id) => fetchFor(id, "accounts")),
      ...cardIds.map((id) => fetchFor(id, "cards")),
    ]);

    let txns = all;
    if (opts.merchant_contains) {
      const needle = opts.merchant_contains.toLowerCase();
      txns = txns.filter((t) =>
        (t.merchant ?? t.description).toLowerCase().includes(needle),
      );
    }
    if (opts.category) {
      txns = txns.filter((t) => t.category === opts.category);
    }
    txns.sort((a, b) => (a.created < b.created ? 1 : -1));
    const limit = Math.min(opts.limit ?? 100, 500);
    return txns.slice(0, limit);
  }

  async getSpending(opts: {
    range: TxnRange;
    account_id?: string;
  }): Promise<SpendingSummary[]> {
    const { accountIds, cardIds } = await this.resolveAccountIds(opts.account_id);
    const { from, to } = resolveRange(opts.range);

    const all: Transaction[] = [];
    const fetchFor = async (id: string, kind: "accounts" | "cards") => {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const res = await this.req<{ results: TLTransaction[] }>(
        `/data/v1/${kind}/${id}/transactions?${params.toString()}`,
      ).catch(() => ({ results: [] as TLTransaction[] }));
      for (const t of res.results ?? []) all.push(toTxn(id, t));
    };
    await Promise.all([
      ...accountIds.map((id) => fetchFor(id, "accounts")),
      ...cardIds.map((id) => fetchFor(id, "cards")),
    ]);

    const perCurrency = new Map<string, {
      buckets: Map<string, SpendingBucket>;
      total_spend: number;
      total_income: number;
    }>();

    for (const t of all) {
      if (t.is_transfer) continue;
      const cur = t.currency;
      let entry = perCurrency.get(cur);
      if (!entry) {
        entry = { buckets: new Map(), total_spend: 0, total_income: 0 };
        perCurrency.set(cur, entry);
      }
      const cat = t.category ?? "uncategorized";
      let b = entry.buckets.get(cat);
      if (!b) {
        b = { category: cat, currency: cur, spend_minor: 0, income_minor: 0, txn_count: 0 };
        entry.buckets.set(cat, b);
      }
      b.txn_count += 1;
      if (t.amount_minor < 0) {
        b.spend_minor += -t.amount_minor;
        entry.total_spend += -t.amount_minor;
      } else {
        b.income_minor += t.amount_minor;
        entry.total_income += t.amount_minor;
      }
    }

    return [...perCurrency.entries()].map(([currency, e]) => ({
      range: opts.range,
      from: from.toISOString(),
      to: to.toISOString(),
      currency,
      total_spend_minor: e.total_spend,
      total_income_minor: e.total_income,
      net_minor: e.total_income - e.total_spend,
      buckets: [...e.buckets.values()].sort((a, b) => b.spend_minor - a.spend_minor),
    }));
  }

  private async resolveAccountIds(
    explicit?: string,
  ): Promise<{ accountIds: string[]; cardIds: string[] }> {
    if (explicit) {
      // We don't know which side it is. Try both — consumer of the returned
      // data filters later. In practice TrueLayer ids are unique across both.
      return { accountIds: [explicit], cardIds: [explicit] };
    }
    const [accounts, cards] = await Promise.all([
      this.req<{ results: TLAccount[] }>(`/data/v1/accounts`).catch(() => ({
        results: [] as TLAccount[],
      })),
      this.req<{ results: TLCard[] }>(`/data/v1/cards`).catch(() => ({
        results: [] as TLCard[],
      })),
    ]);
    return {
      accountIds: (accounts.results ?? []).map((a) => a.account_id),
      cardIds: (cards.results ?? []).map((c) => c.account_id),
    };
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.expiresAt) {
      const expMs = new Date(this.expiresAt).getTime();
      if (Date.now() + SKEW_MS < expMs) return this.accessToken;
    }
    if (!this.refreshToken) {
      if (!this.accessToken) throw new Error("TrueLayer: no access or refresh token");
      return this.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    });
    const res = await fetch(`${this.authBase}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`TrueLayer token refresh failed ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    this.accessToken = json.access_token;
    if (json.refresh_token) this.refreshToken = json.refresh_token;
    this.expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
    await this.persist({
      credentials: {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
      },
      expires_at: this.expiresAt,
    });
    return this.accessToken;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const t = await this.token();
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `TrueLayer ${init.method ?? "GET"} ${path} ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }
}

function inferAccountType(apiType: string): AccountType {
  switch (apiType) {
    case "TRANSACTION":
    case "BUSINESS_TRANSACTION":
      return "current";
    case "SAVINGS":
      return "savings";
    case "CREDIT_CARD":
      return "credit";
    case "LOAN":
      return "loan";
    default:
      return "other";
  }
}

function toMinor(decimal: number): number {
  return Math.round(decimal * 100);
}

function toTxn(accountId: string, t: TLTransaction): Transaction {
  const amount = toMinor(t.amount);
  // TrueLayer returns a positive amount; sign comes from transaction_type.
  const signed = t.transaction_type === "DEBIT" ? -amount : amount;
  const cat = normalizeCategory(t.transaction_category, t.transaction_classification);
  return {
    id: t.transaction_id,
    account_id: accountId,
    amount_minor: signed,
    currency: t.currency,
    created: t.timestamp,
    description: t.description,
    merchant: t.merchant_name ?? null,
    category: cat,
    is_transfer: t.transaction_category === "TRANSFER",
  };
}

// Map TrueLayer's mix of transaction_category + classifications onto the
// Monzo-style category vocabulary so the brain reasons the same way
// regardless of provider.
function normalizeCategory(cat: string, classifications: string[]): string {
  const cls = classifications.map((c) => c.toLowerCase());
  const has = (...needles: string[]) =>
    cls.some((c) => needles.some((n) => c.includes(n)));

  if (cat === "TRANSFER") return "transfers";
  if (cat === "INTEREST" || cat === "DIVIDEND") return "income";
  if (has("groceries", "supermarket")) return "groceries";
  if (has("restaurant", "food", "coffee", "fast food", "takeaway")) return "eating_out";
  if (has("travel", "transport", "taxi", "rail", "uber", "fuel", "parking")) return "transport";
  if (has("entertainment", "cinema", "streaming", "gaming", "music")) return "entertainment";
  if (has("clothing", "shopping", "retail", "electronics")) return "shopping";
  if (has("bills", "utilities", "insurance", "rent", "mortgage", "tax")) return "bills";
  if (has("travel", "hotel", "airline")) return "holidays";
  if (has("health", "pharmacy", "fitness", "beauty")) return "personal_care";
  if (has("gifts", "charity")) return "gifts";
  if (cat === "PURCHASE") return "general";
  if (cat === "ATM") return "cash";
  if (cat === "DIRECT_DEBIT" || cat === "BILL_PAYMENT") return "bills";
  if (cat === "CREDIT") return "income";
  return cat.toLowerCase();
}

function resolveRange(range: TxnRange): { from: Date; to: Date } {
  const now = new Date();
  if (range === "yesterday") {
    const from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(0, 0, 0, 0);
    return { from, to };
  }
  const to = new Date(now);
  const from = new Date(now);
  switch (range) {
    case "today":
      from.setHours(0, 0, 0, 0);
      break;
    case "week": {
      const day = (from.getDay() + 6) % 7;
      from.setDate(from.getDate() - day);
      from.setHours(0, 0, 0, 0);
      break;
    }
    case "month":
    case "mtd":
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
    case "last_7d":
      from.setDate(from.getDate() - 7);
      break;
    case "last_30d":
      from.setDate(from.getDate() - 30);
      break;
    case "last_90d":
      from.setDate(from.getDate() - 90);
      break;
    case "ytd":
      from.setMonth(0, 1);
      from.setHours(0, 0, 0, 0);
      break;
    case "all_time":
      from.setFullYear(from.getFullYear() - 5);
      break;
  }
  return { from, to };
}
