// CoinbaseProvider — CryptoProvider implementation backed by Coinbase's v2
// REST API (https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/api).
// Fetch-based; no SDK.
//
// Auth: OAuth2 (confidential client). Stored credentials:
//   { access_token, refresh_token }  + expires_at on the integrations row.
// Tokens last 2h; refresh_tokens are single-use so the new refresh_token
// MUST be persisted on every refresh.
//
// Pagination: Coinbase v2 uses cursor-based `?starting_after=<id>`. We page
// through until we hit a transaction older than the requested window.

import type {
  CryptoProvider,
  CryptoWallet,
  CryptoTransaction,
  CryptoTxType,
  CryptoTxStatus,
  CryptoTxnRange,
  CryptoPortfolio,
  CryptoPortfolioSlice,
  CryptoSendRequest,
  CryptoSendResult,
} from "./provider";

const API_BASE = "https://api.coinbase.com";
const TOKEN_URL = "https://api.coinbase.com/oauth/token";
// Pin the Coinbase API version so response shapes don't drift under us.
const CB_VERSION = "2024-05-01";
const SKEW_MS = 60_000;

export type CoinbaseCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
};

export type CoinbasePersistFn = (updated: {
  credentials: CoinbaseCredentials;
  expires_at: string;
}) => Promise<void>;

export type CoinbaseProviderOptions = {
  credentials: CoinbaseCredentials;
  expiresAt: string | null;
  persist: CoinbasePersistFn;
  clientId: string;
  clientSecret: string;
};

type CoinbaseMoney = {
  amount: string;
  currency: string;
};

type CoinbaseAccount = {
  id: string;
  name: string;
  primary: boolean;
  type: string; // "wallet" | "fiat" | "vault"
  currency: {
    code: string;
    name: string;
    type: "crypto" | "fiat";
    exponent?: number;
  };
  balance: CoinbaseMoney;
  native_balance: CoinbaseMoney;
  created_at: string;
  updated_at: string;
};

type CoinbaseTransaction = {
  id: string;
  type: string; // buy | sell | send | request | transfer | trade | fiat_deposit | fiat_withdrawal | staking_reward | ...
  status: string; // completed | pending | failed | canceled | expired | waiting_for_signature ...
  amount: CoinbaseMoney; // signed — negative for outflows
  native_amount: CoinbaseMoney;
  description: string | null;
  created_at: string;
  updated_at: string;
  details?: { title?: string; subtitle?: string } | null;
  to?: { resource: string; email?: string; address?: string } | null;
  from?: { resource: string; email?: string; address?: string } | null;
  network?: { status?: string; hash?: string } | null;
};

type CoinbasePage<T> = {
  data: T[];
  pagination?: {
    next_uri?: string | null;
    next_starting_after?: string | null;
  };
};

export class CoinbaseProvider implements CryptoProvider {
  readonly providerName = "coinbase";

  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: string | null;
  private readonly persist: CoinbasePersistFn;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(opts: CoinbaseProviderOptions) {
    this.accessToken = opts.credentials.access_token ?? null;
    this.refreshToken = opts.credentials.refresh_token ?? null;
    this.expiresAt = opts.expiresAt;
    this.persist = opts.persist;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
  }

  async listWallets(): Promise<CryptoWallet[]> {
    const accounts = await this.pagedAll<CoinbaseAccount>("/v2/accounts");
    return accounts.map(toWallet).filter((w) => {
      // Hide dust/empty wallets unless they're the user's primary fiat —
      // Coinbase auto-creates a wallet for every listed asset and 99% are 0.
      if (w.is_fiat) return true;
      return w.balance !== "0" && w.balance !== "0.00000000";
    });
  }

  async listTransactions(opts: {
    wallet_id?: string;
    range?: CryptoTxnRange;
    limit?: number;
  }): Promise<CryptoTransaction[]> {
    const { from } = resolveRange(opts.range ?? "last_30d");
    const fromMs = from.getTime();
    const hardLimit = Math.min(opts.limit ?? 200, 500);

    // If a wallet is specified, query just that one. Otherwise sweep all
    // non-empty wallets — Coinbase doesn't have an account-global tx endpoint.
    const walletIds = opts.wallet_id
      ? [opts.wallet_id]
      : (await this.listWallets()).map((w) => w.id);

    const collected: CryptoTransaction[] = [];
    for (const wid of walletIds) {
      const raw = await this.pagedAll<CoinbaseTransaction>(
        `/v2/accounts/${encodeURIComponent(wid)}/transactions`,
        { until: fromMs, maxItems: hardLimit },
      );
      for (const r of raw) {
        collected.push(toTxn(r, wid));
      }
      if (collected.length >= hardLimit) break;
    }

    collected.sort((a, b) => (a.created < b.created ? 1 : -1));
    return collected.slice(0, hardLimit);
  }

  async getPortfolio(opts?: { native_currency?: string }): Promise<CryptoPortfolio> {
    const wallets = await this.listWallets();
    // Coinbase returns native_balance per the user's preferred fiat, not a
    // parameter we can pass. If the caller requests a different currency we
    // surface what we have; cross-currency conversion would need /v2/prices.
    const native = opts?.native_currency ?? wallets[0]?.native_currency ?? "USD";

    const slices: CryptoPortfolioSlice[] = wallets
      .filter((w) => !w.is_fiat)
      .map((w) => ({
        asset: w.asset,
        balance: w.balance,
        value_minor: w.native_value_minor,
        pct: 0,
      }));

    const total = slices.reduce((s, x) => s + x.value_minor, 0);
    for (const s of slices) {
      s.pct = total === 0 ? 0 : s.value_minor / total;
    }
    slices.sort((a, b) => b.value_minor - a.value_minor);

    return {
      native_currency: native,
      total_value_minor: total,
      by_asset: slices,
    };
  }

  async send(req: CryptoSendRequest): Promise<CryptoSendResult> {
    // POST /v2/accounts/:id/transactions  body { type: "send", to, amount, currency, idem }
    // `to` can be a Coinbase user email OR an on-chain address — caller has
    // already resolved this via the whitelist.
    //
    // 2FA: if the user has withdrawal 2FA enabled, Coinbase returns 402 with
    // a CB-2FA-Token challenge. Resubmit the same request + CB-2FA-Token
    // header once the user supplies the code.
    const path = `/v2/accounts/${encodeURIComponent(req.wallet_id)}/transactions`;
    const body = {
      type: "send",
      to: req.destination,
      amount: req.amount,
      currency: req.asset,
      idem: req.idempotency_key,
    };
    const t = await this.token();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      "CB-VERSION": CB_VERSION,
    };
    if (req.two_factor_token) headers["CB-2FA-Token"] = req.two_factor_token;

    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 402) {
      return {
        status: "two_factor_required",
        message: "Coinbase 2FA code required — check your authenticator app",
      };
    }
    if (!res.ok) {
      const txt = await res.text();
      return { status: "failed", error: `HTTP ${res.status}: ${txt.slice(0, 300)}` };
    }
    const json = (await res.json()) as { data?: CoinbaseTransaction };
    const tx = json.data;
    if (!tx?.id) {
      return { status: "failed", error: "Coinbase returned no transaction id" };
    }
    const mapped = mapTxStatus(tx.status);
    return {
      status: mapped === "completed" ? "completed" : "pending",
      provider_tx_id: tx.id,
      raw: json,
    };
  }

  private async pagedAll<T>(
    path: string,
    opts: { until?: number; maxItems?: number } = {},
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 30; page++) {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("starting_after", cursor);
      const res = await this.req<CoinbasePage<T>>(`${path}?${params.toString()}`);
      const batch = res.data ?? [];
      if (batch.length === 0) break;

      // Early-exit on age — works for transactions which are newest-first.
      if (opts.until !== undefined) {
        let stop = false;
        for (const item of batch) {
          const createdAt = (item as unknown as { created_at?: string }).created_at;
          if (createdAt && new Date(createdAt).getTime() < opts.until) {
            stop = true;
            break;
          }
          out.push(item);
          if (opts.maxItems && out.length >= opts.maxItems) {
            stop = true;
            break;
          }
        }
        if (stop) break;
      } else {
        out.push(...batch);
        if (opts.maxItems && out.length >= opts.maxItems) break;
      }

      const next = res.pagination?.next_starting_after;
      if (!next) break;
      cursor = next;
    }
    return out;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.expiresAt) {
      const expMs = new Date(this.expiresAt).getTime();
      if (Date.now() + SKEW_MS < expMs) return this.accessToken;
    }
    if (!this.refreshToken) {
      if (!this.accessToken) throw new Error("Coinbase: no access or refresh token");
      return this.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Coinbase token refresh failed ${res.status}: ${t.slice(0, 200)}`);
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
        "CB-VERSION": CB_VERSION,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Coinbase ${init.method ?? "GET"} ${path} ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }
}

function toWallet(a: CoinbaseAccount): CryptoWallet {
  const isFiat = a.currency.type === "fiat";
  return {
    id: a.id,
    name: a.name,
    asset: a.currency.code,
    asset_name: a.currency.name,
    balance: a.balance.amount,
    native_currency: a.native_balance.currency,
    native_value_minor: fiatToMinor(a.native_balance.amount, a.native_balance.currency),
    is_fiat: isFiat,
    created: a.created_at,
  };
}

function toTxn(t: CoinbaseTransaction, walletId: string): CryptoTransaction {
  const counterparty =
    t.to?.email ?? t.to?.address ?? t.from?.email ?? t.from?.address ?? null;
  return {
    id: t.id,
    wallet_id: walletId,
    type: mapTxType(t.type),
    asset: t.amount.currency,
    amount: t.amount.amount,
    native_currency: t.native_amount.currency,
    native_amount_minor: fiatToMinorSigned(t.native_amount.amount, t.native_amount.currency),
    created: t.created_at,
    description: t.details?.title ?? t.description ?? null,
    counterparty,
    status: mapTxStatus(t.status),
  };
}

function mapTxType(t: string): CryptoTxType {
  switch (t) {
    case "buy":
    case "sell":
    case "send":
    case "trade":
    case "fiat_deposit":
    case "fiat_withdrawal":
    case "staking_reward":
      return t;
    case "transfer":
      return "send";
    case "request":
      return "receive";
    default:
      return "other";
  }
}

function mapTxStatus(s: string): CryptoTxStatus {
  if (s === "completed") return "completed";
  if (s === "failed" || s === "canceled" || s === "expired") return "failed";
  return "pending";
}

// Coinbase returns amounts as decimal strings in major units ("12.34" GBP).
// Most fiat has 2dp; we round rather than truncate so 19.999 → 2000p.
function fiatToMinor(amount: string, currency: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  const exponent = fiatExponent(currency);
  return Math.round(n * 10 ** exponent);
}

function fiatToMinorSigned(amount: string, currency: string): number {
  return fiatToMinor(amount, currency);
}

function fiatExponent(currency: string): number {
  // Zero-decimal fiat currencies per ISO 4217.
  const zero = new Set(["JPY", "KRW", "VND", "CLP", "IDR", "ISK"]);
  if (zero.has(currency.toUpperCase())) return 0;
  return 2;
}

function resolveRange(range: CryptoTxnRange): { from: Date; to: Date } {
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
      from.setFullYear(from.getFullYear() - 10);
      break;
  }
  return { from, to };
}
