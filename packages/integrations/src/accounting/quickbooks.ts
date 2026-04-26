// QuickBooksProvider — AccountingProvider implementation backed by Intuit's
// QuickBooks Online REST API.
//
// OAuth2 with access+refresh tokens. Multi-realm: a single OAuth connection
// identifies one company (realmId) — we persist it in credentials.

import type {
  AccountingProvider,
  Invoice,
  InvoiceStatus,
  Expense,
  Balance,
  Contact,
} from "./provider";

export type QuickBooksEnv = "live" | "sandbox";

export type QuickBooksCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
  realm_id?: string | null;
  env?: QuickBooksEnv | null;
};

export type QuickBooksPersistUpdate = {
  credentials: QuickBooksCredentials;
  expires_at: string;
};

export type QuickBooksProviderOptions = {
  credentials: QuickBooksCredentials;
  expiresAt: string | null;
  clientId: string;
  clientSecret: string;
  persist: (update: QuickBooksPersistUpdate) => Promise<void>;
};

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API_BASES: Record<QuickBooksEnv, string> = {
  live: "https://quickbooks.api.intuit.com/v3/company",
  sandbox: "https://sandbox-quickbooks.api.intuit.com/v3/company",
};

export class QuickBooksProvider implements AccountingProvider {
  readonly providerName = "quickbooks";

  private credentials: QuickBooksCredentials;
  private expiresAt: Date | null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly persist: (update: QuickBooksPersistUpdate) => Promise<void>;
  private readonly base: string;
  private readonly realmId: string;

  constructor(opts: QuickBooksProviderOptions) {
    if (!opts.credentials.access_token || !opts.credentials.refresh_token) {
      throw new Error("QuickBooks integration missing tokens");
    }
    if (!opts.credentials.realm_id) {
      throw new Error("QuickBooks integration missing realm_id");
    }
    this.credentials = opts.credentials;
    this.expiresAt = opts.expiresAt ? new Date(opts.expiresAt) : null;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.persist = opts.persist;
    this.base = API_BASES[opts.credentials.env ?? "live"];
    this.realmId = opts.credentials.realm_id;
  }

  async listInvoices(opts: {
    limit: number;
    status?: InvoiceStatus;
    sinceDays?: number;
  }): Promise<Invoice[]> {
    const wheres: string[] = [];
    if (opts.sinceDays !== undefined) {
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
      wheres.push(`TxnDate >= '${since.toISOString().slice(0, 10)}'`);
    }
    const query = `SELECT * FROM Invoice${wheres.length ? ` WHERE ${wheres.join(" AND ")}` : ""} ORDER BY TxnDate DESC MAXRESULTS ${Math.min(opts.limit, 1000)}`;
    const json = await this.query<{ QueryResponse?: { Invoice?: QBInvoice[] } }>(query);
    const invoices = json.QueryResponse?.Invoice ?? [];
    const mapped = invoices.map(toInvoice);
    return opts.status ? mapped.filter((m) => m.status === opts.status) : mapped;
  }

  async listExpenses(opts: {
    limit: number;
    sinceDays?: number;
  }): Promise<Expense[]> {
    const wheres: string[] = [];
    if (opts.sinceDays !== undefined) {
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
      wheres.push(`TxnDate >= '${since.toISOString().slice(0, 10)}'`);
    }
    const query = `SELECT * FROM Purchase${wheres.length ? ` WHERE ${wheres.join(" AND ")}` : ""} ORDER BY TxnDate DESC MAXRESULTS ${Math.min(opts.limit, 1000)}`;
    const json = await this.query<{ QueryResponse?: { Purchase?: QBPurchase[] } }>(query);
    return (json.QueryResponse?.Purchase ?? []).map((p) => ({
      id: p.Id ?? "",
      vendor: p.EntityRef?.name ?? null,
      category: p.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.name ?? null,
      amount_cents: Math.round(Number(p.TotalAmt ?? 0) * 100),
      currency: p.CurrencyRef?.value ?? "USD",
      date: p.TxnDate ?? new Date().toISOString(),
      description: p.PrivateNote ?? null,
    }));
  }

  async listBalances(): Promise<Balance[]> {
    const json = await this.query<{
      QueryResponse?: { Account?: QBAccount[] };
    }>("SELECT * FROM Account MAXRESULTS 200");
    return (json.QueryResponse?.Account ?? []).map((a) => ({
      account_id: a.Id ?? "",
      account_name: a.Name ?? "",
      account_type: (a.AccountType ?? "").toLowerCase(),
      balance_cents: Math.round(Number(a.CurrentBalance ?? 0) * 100),
      currency: a.CurrencyRef?.value ?? "USD",
    }));
  }

  async listContacts(opts: {
    limit: number;
    role?: "customer" | "supplier";
  }): Promise<Contact[]> {
    const contacts: Contact[] = [];
    if (opts.role !== "supplier") {
      const json = await this.query<{
        QueryResponse?: { Customer?: QBCustomer[] };
      }>(`SELECT * FROM Customer MAXRESULTS ${Math.min(opts.limit, 200)}`);
      for (const c of json.QueryResponse?.Customer ?? []) {
        contacts.push({
          id: c.Id ?? "",
          name: c.DisplayName ?? "",
          email: c.PrimaryEmailAddr?.Address ?? null,
          role: "customer",
        });
      }
    }
    if (opts.role !== "customer") {
      const json = await this.query<{
        QueryResponse?: { Vendor?: QBVendor[] };
      }>(`SELECT * FROM Vendor MAXRESULTS ${Math.min(opts.limit, 200)}`);
      for (const v of json.QueryResponse?.Vendor ?? []) {
        contacts.push({
          id: v.Id ?? "",
          name: v.DisplayName ?? "",
          email: v.PrimaryEmailAddr?.Address ?? null,
          role: "supplier",
        });
      }
    }
    return contacts.slice(0, opts.limit);
  }

  private async query<T>(q: string): Promise<T> {
    const token = await this.ensureAccessToken();
    const url = new URL(`${this.base}/${this.realmId}/query`);
    url.searchParams.set("query", q);
    url.searchParams.set("minorversion", "73");
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`QuickBooks query failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private async ensureAccessToken(): Promise<string> {
    const skewMs = 30_000;
    if (this.expiresAt && this.expiresAt.getTime() - skewMs > Date.now()) {
      return this.credentials.access_token!;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refresh_token!,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`QuickBooks token refresh failed (${res.status})`);
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const newExp = new Date(Date.now() + json.expires_in * 1000);
    this.credentials = {
      ...this.credentials,
      access_token: json.access_token,
      refresh_token: json.refresh_token,
    };
    this.expiresAt = newExp;
    await this.persist({
      credentials: this.credentials,
      expires_at: newExp.toISOString(),
    });
    return json.access_token;
  }
}

type QBInvoice = {
  Id?: string;
  DocNumber?: string;
  CustomerRef?: { value?: string; name?: string };
  TotalAmt?: number;
  Balance?: number;
  CurrencyRef?: { value?: string };
  TxnDate?: string;
  DueDate?: string;
  EmailStatus?: string;
};

type QBPurchase = {
  Id?: string;
  EntityRef?: { name?: string };
  TotalAmt?: number;
  TxnDate?: string;
  CurrencyRef?: { value?: string };
  PrivateNote?: string;
  Line?: {
    AccountBasedExpenseLineDetail?: { AccountRef?: { name?: string } };
  }[];
};

type QBAccount = {
  Id?: string;
  Name?: string;
  AccountType?: string;
  CurrentBalance?: number;
  CurrencyRef?: { value?: string };
};

type QBCustomer = {
  Id?: string;
  DisplayName?: string;
  PrimaryEmailAddr?: { Address?: string };
};

type QBVendor = {
  Id?: string;
  DisplayName?: string;
  PrimaryEmailAddr?: { Address?: string };
};

function toInvoice(i: QBInvoice): Invoice {
  const total = Number(i.TotalAmt ?? 0);
  const balance = Number(i.Balance ?? 0);
  const status: InvoiceStatus =
    balance === 0 && total > 0
      ? "paid"
      : i.EmailStatus === "EmailSent"
        ? "sent"
        : "draft";
  return {
    id: i.Id ?? "",
    number: i.DocNumber ?? null,
    customer_id: i.CustomerRef?.value ?? null,
    customer_name: i.CustomerRef?.name ?? null,
    amount_cents: Math.round(total * 100),
    currency: i.CurrencyRef?.value ?? "USD",
    status,
    issued: i.TxnDate ?? new Date().toISOString(),
    due: i.DueDate ?? null,
    paid_at: balance === 0 && total > 0 ? i.DueDate ?? null : null,
  };
}
