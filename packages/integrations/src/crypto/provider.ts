// CryptoProvider — capability interface for any user crypto/exchange backend.
//
// Read-only for the first cut. Buys, sells, sends, and withdrawals must route
// through needs_approval tasks — never directly from a brain tool.
//
// Designed to be implementable on: Coinbase (day one), Binance, Kraken,
// Gemini. Crypto balances are decimal strings (arbitrary precision — BTC has
// 8 dp, ETH has 18) because JS Number loses precision at those magnitudes.
// Fiat values are minor units to match BankingProvider.
//
// Wallets include fiat-denominated wallets (GBP on Coinbase) because they
// hold funding balances; callers can filter with `is_fiat`.
//
// `asset` is the ticker symbol — "BTC", "ETH", "USDC". `native_currency` is
// the user's reporting fiat — typically "USD" or "GBP".

export type CryptoTxnRange =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "mtd"
  | "last_7d"
  | "last_30d"
  | "last_90d"
  | "ytd"
  | "all_time";

export type CryptoWallet = {
  id: string;
  name: string;
  asset: string;
  asset_name: string;
  // Decimal string — do NOT parseFloat; keep as-is for display + arithmetic.
  balance: string;
  native_currency: string;
  // Fiat value of `balance` at the time of fetch, in minor units.
  native_value_minor: number;
  is_fiat: boolean;
  created?: string;
};

export type CryptoTxType =
  | "buy"
  | "sell"
  | "send"
  | "receive"
  | "trade"
  | "fiat_deposit"
  | "fiat_withdrawal"
  | "staking_reward"
  | "other";

export type CryptoTxStatus = "completed" | "pending" | "failed";

export type CryptoTransaction = {
  id: string;
  wallet_id: string;
  type: CryptoTxType;
  asset: string;
  // Signed decimal string — negative = outflow, positive = inflow.
  amount: string;
  native_currency: string;
  // Signed fiat-value at tx time in minor units.
  native_amount_minor: number;
  created: string;
  description: string | null;
  // Counterparty email/address/exchange-side for sends/receives; null otherwise.
  counterparty: string | null;
  status: CryptoTxStatus;
};

export type CryptoPortfolioSlice = {
  asset: string;
  balance: string;
  value_minor: number;
  pct: number;
};

export type CryptoPortfolio = {
  native_currency: string;
  total_value_minor: number;
  by_asset: CryptoPortfolioSlice[];
};

// Send request. Caller resolves the whitelist row to a concrete destination
// BEFORE calling the provider — the provider itself never sees a raw label,
// only the pre-verified `destination` string (an on-chain address for Kraken,
// an address OR a Coinbase user email for Coinbase). `destination_label` is
// passed through for audit/logging only.
export type CryptoSendRequest = {
  wallet_id: string;
  asset: string;
  // Decimal string — same format as CryptoWallet.balance.
  amount: string;
  destination: string;
  destination_label: string;
  // Required for Kraken — must be the label pre-registered on kraken.com.
  // For Coinbase, this doubles as the destination (email or address).
  network?: string;
  // Opaque caller-supplied string used to prevent double-sends on retry.
  idempotency_key: string;
  // Coinbase re-submit token. Present on the second call after a 2FA challenge.
  two_factor_token?: string;
};

export type CryptoSendResult =
  | { status: "completed"; provider_tx_id: string; raw?: unknown }
  | { status: "pending"; provider_tx_id: string; raw?: unknown }
  | { status: "two_factor_required"; message: string }
  | { status: "failed"; error: string };

export interface CryptoProvider {
  readonly providerName: string;

  listWallets(): Promise<CryptoWallet[]>;

  listTransactions(opts: {
    wallet_id?: string;
    range?: CryptoTxnRange;
    limit?: number;
  }): Promise<CryptoTransaction[]>;

  getPortfolio(opts?: { native_currency?: string }): Promise<CryptoPortfolio>;

  // Write capability. Implementations MUST route through whatever the
  // upstream exchange's own safety controls are (address allowlist on
  // Kraken, 2FA on Coinbase) — this is layer 2, JARVIS's own whitelist
  // is layer 1.
  send(req: CryptoSendRequest): Promise<CryptoSendResult>;
}
