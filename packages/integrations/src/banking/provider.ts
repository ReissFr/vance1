// BankingProvider — capability interface for any user banking backend.
//
// Read-only for the first cut. Any write operation (transfers, pot moves,
// standing orders) MUST go through the needs_approval task flow — never
// direct from a brain-level tool call.
//
// Designed to be implementable on Monzo (day one), TrueLayer (all UK banks),
// Plaid (global). Amounts are minor units (pence/cents) to avoid float drift.

export type AccountType =
  | "current"
  | "savings"
  | "credit"
  | "pot"
  | "loan"
  | "other";

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance_minor: number;
  // Some providers expose "available" separately (pending holds). Optional.
  available_minor?: number;
  created?: string;
};

export type TxnRange =
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

export type Transaction = {
  id: string;
  account_id: string;
  // Signed minor units. Negative = spend, positive = money in.
  amount_minor: number;
  currency: string;
  created: string;
  description: string;
  merchant: string | null;
  category: string | null;
  // Internal transfers (account ↔ pot, between own accounts) — set true so
  // spending aggregations can exclude them.
  is_transfer?: boolean;
  is_pending?: boolean;
};

export type SpendingBucket = {
  category: string;
  currency: string;
  spend_minor: number;
  income_minor: number;
  txn_count: number;
};

export type SpendingSummary = {
  range: TxnRange;
  from: string;
  to: string;
  currency: string;
  total_spend_minor: number;
  total_income_minor: number;
  net_minor: number;
  buckets: SpendingBucket[];
};

export interface BankingProvider {
  readonly providerName: string;

  listAccounts(): Promise<Account[]>;

  listTransactions(opts: {
    account_id?: string;
    range?: TxnRange;
    limit?: number;
    merchant_contains?: string;
    category?: string;
  }): Promise<Transaction[]>;

  // Aggregate spending by category for the given range. Excludes transfers.
  getSpending(opts: {
    range: TxnRange;
    account_id?: string;
  }): Promise<SpendingSummary[]>;
}
