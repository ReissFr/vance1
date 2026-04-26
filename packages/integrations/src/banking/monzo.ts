// MonzoProvider — BankingProvider implementation backed by Monzo's REST API
// (https://docs.monzo.com/). Fetch-based; no SDK.
//
// Auth: OAuth2 (confidential client). Stored credentials:
//   { access_token, refresh_token }  + expires_at on the integrations row.
// On every request we refresh if expired/near-expiry and persist new tokens.
//
// Quirk: after initial authorization the token is SCA-gated for 5 min. Once
// the user approves in the Monzo app, the refresh_token remains valid
// indefinitely (until re-auth is forced). Refresh tokens are single-use —
// every refresh gives a new refresh_token we MUST store.

import type {
  BankingProvider,
  Account,
  AccountType,
  Transaction,
  TxnRange,
  SpendingSummary,
  SpendingBucket,
} from "./provider";

const API_BASE = "https://api.monzo.com";
const AUTH_BASE = "https://api.monzo.com/oauth2/token";
const SKEW_MS = 60_000;

export type MonzoCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
};

export type MonzoPersistFn = (updated: {
  credentials: MonzoCredentials;
  expires_at: string;
}) => Promise<void>;

export type MonzoProviderOptions = {
  credentials: MonzoCredentials;
  expiresAt: string | null;
  persist: MonzoPersistFn;
  clientId: string;
  clientSecret: string;
};

type MonzoAccount = {
  id: string;
  description: string;
  type: string; // "uk_retail", "uk_retail_joint", "uk_monzo_flex", etc.
  currency: string;
  created: string;
  closed: boolean;
};

type MonzoBalance = {
  balance: number;
  total_balance: number;
  currency: string;
  spend_today: number;
};

type MonzoPot = {
  id: string;
  name: string;
  style: string;
  balance: number;
  currency: string;
  created: string;
  current_account_id: string;
  deleted: boolean;
};

type MonzoMerchant = {
  id: string;
  name: string;
  category: string;
  logo?: string;
};

type MonzoTransaction = {
  id: string;
  account_id: string;
  amount: number; // minor units, signed
  currency: string;
  description: string;
  category: string;
  created: string;
  merchant: MonzoMerchant | string | null;
  decline_reason?: string | null;
  scheme: string;
  include_in_spending: boolean;
  settled?: string | null;
  metadata?: Record<string, string> | null;
  notes?: string | null;
};

export class MonzoProvider implements BankingProvider {
  readonly providerName = "monzo";

  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: string | null;
  private readonly persist: MonzoPersistFn;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(opts: MonzoProviderOptions) {
    this.accessToken = opts.credentials.access_token ?? null;
    this.refreshToken = opts.credentials.refresh_token ?? null;
    this.expiresAt = opts.expiresAt;
    this.persist = opts.persist;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
  }

  async listAccounts(): Promise<Account[]> {
    const [accountsRes, potsByAccount] = await Promise.all([
      this.req<{ accounts: MonzoAccount[] }>(`/accounts`),
      this.listAllPots(),
    ]);

    const active = (accountsRes.accounts ?? []).filter((a) => !a.closed);
    const out: Account[] = [];

    // Fetch balance per account in parallel.
    const balances = await Promise.all(
      active.map((a) =>
        this.req<MonzoBalance>(`/balance?account_id=${encodeURIComponent(a.id)}`).catch(
          () => null,
        ),
      ),
    );

    for (let i = 0; i < active.length; i++) {
      const a = active[i]!;
      const b = balances[i];
      out.push({
        id: a.id,
        name: prettyAccountName(a),
        type: inferAccountType(a),
        currency: a.currency,
        balance_minor: b?.balance ?? 0,
        available_minor: b?.total_balance,
        created: a.created,
      });

      for (const p of potsByAccount.get(a.id) ?? []) {
        out.push({
          id: p.id,
          name: `${p.name} (pot)`,
          type: "pot",
          currency: p.currency,
          balance_minor: p.balance,
          created: p.created,
        });
      }
    }
    return out;
  }

  async listTransactions(opts: {
    account_id?: string;
    range?: TxnRange;
    limit?: number;
    merchant_contains?: string;
    category?: string;
  }): Promise<Transaction[]> {
    const accountId = await this.resolveAccountId(opts.account_id);
    const { from, to } = resolveRange(opts.range ?? "last_30d");
    const params = new URLSearchParams({
      account_id: accountId,
      "expand[]": "merchant",
      since: from.toISOString(),
      before: to.toISOString(),
      limit: String(Math.min(opts.limit ?? 100, 100)),
    });
    const res = await this.req<{ transactions: MonzoTransaction[] }>(
      `/transactions?${params.toString()}`,
    );

    let txns = (res.transactions ?? [])
      .filter((t) => !t.decline_reason)
      .map(toTxn);

    if (opts.merchant_contains) {
      const needle = opts.merchant_contains.toLowerCase();
      txns = txns.filter((t) =>
        (t.merchant ?? t.description).toLowerCase().includes(needle),
      );
    }
    if (opts.category) {
      txns = txns.filter((t) => t.category === opts.category);
    }

    // Newest first.
    txns.sort((a, b) => (a.created < b.created ? 1 : -1));
    return txns;
  }

  async getSpending(opts: {
    range: TxnRange;
    account_id?: string;
  }): Promise<SpendingSummary[]> {
    const accountId = await this.resolveAccountId(opts.account_id);
    const { from, to } = resolveRange(opts.range);

    // Page through — Monzo caps at 100 per request.
    let before = to.toISOString();
    const collected: MonzoTransaction[] = [];
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({
        account_id: accountId,
        "expand[]": "merchant",
        since: from.toISOString(),
        before,
        limit: "100",
      });
      const res = await this.req<{ transactions: MonzoTransaction[] }>(
        `/transactions?${params.toString()}`,
      );
      const batch = res.transactions ?? [];
      if (batch.length === 0) break;
      collected.push(...batch);
      // Oldest in batch becomes the next `before`.
      const oldest = batch.reduce((a, b) => (a.created < b.created ? a : b));
      before = oldest.created;
      if (batch.length < 100) break;
    }

    const perCurrency = new Map<string, {
      buckets: Map<string, SpendingBucket>;
      total_spend: number;
      total_income: number;
    }>();

    for (const raw of collected) {
      if (raw.decline_reason) continue;
      if (!raw.include_in_spending && raw.amount < 0) continue; // skip transfers-out
      const t = toTxn(raw);
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

  private async resolveAccountId(explicit?: string): Promise<string> {
    if (explicit) return explicit;
    const accounts = await this.req<{ accounts: MonzoAccount[] }>(`/accounts`);
    const primary = (accounts.accounts ?? []).find(
      (a) => !a.closed && (a.type === "uk_retail" || a.type === "uk_retail_joint"),
    );
    if (!primary) throw new Error("No active Monzo retail account found");
    return primary.id;
  }

  private async listAllPots(): Promise<Map<string, MonzoPot[]>> {
    const accounts = await this.req<{ accounts: MonzoAccount[] }>(`/accounts`);
    const by = new Map<string, MonzoPot[]>();
    await Promise.all(
      (accounts.accounts ?? [])
        .filter((a) => !a.closed)
        .map(async (a) => {
          try {
            const res = await this.req<{ pots: MonzoPot[] }>(
              `/pots?current_account_id=${encodeURIComponent(a.id)}`,
            );
            by.set(
              a.id,
              (res.pots ?? []).filter((p) => !p.deleted),
            );
          } catch {
            by.set(a.id, []);
          }
        }),
    );
    return by;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.expiresAt) {
      const expMs = new Date(this.expiresAt).getTime();
      if (Date.now() + SKEW_MS < expMs) return this.accessToken;
    }
    if (!this.refreshToken) {
      if (!this.accessToken) throw new Error("Monzo: no access or refresh token");
      return this.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    });
    const res = await fetch(AUTH_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Monzo token refresh failed ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    this.accessToken = json.access_token;
    this.refreshToken = json.refresh_token;
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
    const res = await fetch(`${API_BASE}${path}`, {
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
        `Monzo ${init.method ?? "GET"} ${path} ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }
}

function prettyAccountName(a: MonzoAccount): string {
  if (a.description) return a.description;
  switch (a.type) {
    case "uk_retail":
      return "Monzo Current";
    case "uk_retail_joint":
      return "Monzo Joint";
    case "uk_monzo_flex":
      return "Monzo Flex";
    default:
      return a.type;
  }
}

function inferAccountType(a: MonzoAccount): AccountType {
  if (a.type === "uk_monzo_flex") return "credit";
  if (a.type === "uk_retail" || a.type === "uk_retail_joint") return "current";
  return "other";
}

function toTxn(t: MonzoTransaction): Transaction {
  const merchant =
    t.merchant && typeof t.merchant === "object"
      ? t.merchant.name
      : typeof t.merchant === "string"
      ? null // merchant id w/o expansion — fall back to description
      : null;
  return {
    id: t.id,
    account_id: t.account_id,
    amount_minor: t.amount,
    currency: t.currency,
    created: t.created,
    description: t.description,
    merchant,
    category: t.category ?? null,
    is_transfer: !t.include_in_spending,
    is_pending: !t.settled,
  };
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
      const day = (from.getDay() + 6) % 7; // Mon=0
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
