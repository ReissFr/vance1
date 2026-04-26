// AccountingProvider — capability interface for a user's accounting system.
//
// Read-only for the first cut. Raising invoices, recording expenses, and
// reconciling will route through the task-approval flow later (signatures
// on the books are not something to execute direct from a chat).
//
// Must be implementable on: Xero, QuickBooks Online, FreeAgent.

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export type Invoice = {
  id: string;
  number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  issued: string;
  due: string | null;
  paid_at: string | null;
};

export type Expense = {
  id: string;
  vendor: string | null;
  category: string | null;
  amount_cents: number;
  currency: string;
  date: string;
  description: string | null;
};

export type Balance = {
  account_id: string;
  account_name: string;
  account_type: string; // e.g. "bank", "credit_card", "revenue", "expense"
  balance_cents: number;
  currency: string;
};

export type Contact = {
  id: string;
  name: string;
  email: string | null;
  role: "customer" | "supplier" | "both" | null;
};

export type AccountingRange =
  | "today"
  | "week"
  | "month"
  | "mtd"
  | "last_30d"
  | "last_90d"
  | "ytd"
  | "year"
  | "all_time";

export interface AccountingProvider {
  readonly providerName: string;

  listInvoices(opts: {
    limit: number;
    status?: InvoiceStatus;
    sinceDays?: number;
  }): Promise<Invoice[]>;

  listExpenses(opts: {
    limit: number;
    sinceDays?: number;
  }): Promise<Expense[]>;

  // Top-line balance sheet: every account with its current balance.
  listBalances(): Promise<Balance[]>;

  listContacts(opts: {
    limit: number;
    role?: "customer" | "supplier";
  }): Promise<Contact[]>;
}
