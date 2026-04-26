// PaymentProvider — capability interface for any user payment backend.
//
// Intentionally read-only for the first cut. Destructive ops (refund,
// cancel_subscription, payout) will be added as a follow-up and gated through
// the needs_approval task flow — they should never execute directly from a
// brain-level tool call.
//
// The interface must be implementable on: Stripe, Paddle, LemonSqueezy. All
// three expose customers / charges / subscriptions with slightly different
// shapes; this interface normalizes them.

export type RevenueRange =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "mtd"
  | "last_30d"
  | "last_90d"
  | "year"
  | "ytd"
  | "all_time";

// Revenue is reported per-currency — a Stripe account can take GBP and USD
// side-by-side, and mixing them would lie about the totals.
export type RevenueSummary = {
  currency: string;
  gross_cents: number;
  net_cents: number;
  charge_count: number;
  refund_count: number;
  range: RevenueRange;
  from: string;
  to: string;
};

export type Customer = {
  id: string;
  email: string | null;
  name: string | null;
  created: string;
  total_spend_cents: number | null;
};

export type ChargeStatus = "succeeded" | "failed" | "pending" | "refunded";

export type Charge = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
  amount_cents: number;
  currency: string;
  status: ChargeStatus;
  created: string;
  description: string | null;
};

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid";

export type Subscription = {
  id: string;
  customer_id: string;
  customer_email: string | null;
  status: SubscriptionStatus;
  product_name: string | null;
  amount_cents: number | null;
  currency: string | null;
  interval: "day" | "week" | "month" | "year" | null;
  started: string;
  canceled_at: string | null;
};

export interface PaymentProvider {
  readonly providerName: string;

  // Revenue for a time range, split by currency. Empty array = no activity.
  listRevenue(range: RevenueRange): Promise<RevenueSummary[]>;

  // Customers, newest first. `sinceDays` filters to customers created within
  // the last N days; undefined returns the most recent `limit` customers.
  listCustomers(opts: { limit: number; sinceDays?: number }): Promise<Customer[]>;

  listCharges(opts: {
    limit: number;
    sinceDays?: number;
    status?: ChargeStatus;
  }): Promise<Charge[]>;

  listSubscriptions(opts: {
    limit: number;
    status?: SubscriptionStatus;
  }): Promise<Subscription[]>;
}
