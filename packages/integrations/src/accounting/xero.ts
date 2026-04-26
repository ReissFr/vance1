// XeroProvider — AccountingProvider implementation backed by Xero's OAuth2
// Accounting API.
//
// Xero is multi-tenant: a single OAuth connection can grant access to
// multiple organisations the user belongs to. We persist the selected
// `tenant_id` in credentials and every API call carries it as
// `Xero-Tenant-Id`.

import type {
  AccountingProvider,
  Invoice,
  InvoiceStatus,
  Expense,
  Balance,
  Contact,
} from "./provider";

export type XeroCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
  tenant_id?: string | null;
  tenant_name?: string | null;
};

export type XeroPersistUpdate = {
  credentials: XeroCredentials;
  expires_at: string;
};

export type XeroProviderOptions = {
  credentials: XeroCredentials;
  expiresAt: string | null;
  clientId: string;
  clientSecret: string;
  persist: (update: XeroPersistUpdate) => Promise<void>;
};

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";

export class XeroProvider implements AccountingProvider {
  readonly providerName = "xero";

  private credentials: XeroCredentials;
  private expiresAt: Date | null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly persist: (update: XeroPersistUpdate) => Promise<void>;

  constructor(opts: XeroProviderOptions) {
    if (!opts.credentials.access_token || !opts.credentials.refresh_token) {
      throw new Error("Xero integration missing access_token/refresh_token");
    }
    if (!opts.credentials.tenant_id) {
      throw new Error("Xero integration missing tenant_id — user must select an org");
    }
    this.credentials = opts.credentials;
    this.expiresAt = opts.expiresAt ? new Date(opts.expiresAt) : null;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.persist = opts.persist;
  }

  async listInvoices(opts: {
    limit: number;
    status?: InvoiceStatus;
    sinceDays?: number;
  }): Promise<Invoice[]> {
    const params: Record<string, string> = {
      order: "Date DESC",
      page: "1",
    };
    const wheres: string[] = [];
    if (opts.status) wheres.push(`Status=="${mapStatusToXero(opts.status)}"`);
    if (opts.sinceDays !== undefined) {
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
      wheres.push(`Date >= DateTime(${since.getUTCFullYear()},${since.getUTCMonth() + 1},${since.getUTCDate()})`);
    }
    if (wheres.length) params.where = wheres.join(" && ");

    const json = await this.get<{ Invoices?: XeroInvoice[] }>("/Invoices", params);
    return (json.Invoices ?? []).slice(0, opts.limit).map((i) => ({
      id: i.InvoiceID ?? "",
      number: i.InvoiceNumber ?? null,
      customer_id: i.Contact?.ContactID ?? null,
      customer_name: i.Contact?.Name ?? null,
      amount_cents: Math.round(Number(i.Total ?? 0) * 100),
      currency: i.CurrencyCode ?? "GBP",
      status: mapStatusFromXero(i.Status),
      issued: parseXeroDate(i.Date) ?? new Date().toISOString(),
      due: parseXeroDate(i.DueDate),
      paid_at: parseXeroDate(i.FullyPaidOnDate),
    }));
  }

  async listExpenses(opts: { limit: number; sinceDays?: number }): Promise<Expense[]> {
    // Xero represents expenses as bills (AP invoices) — Type == ACCPAY.
    const wheres: string[] = [`Type=="ACCPAY"`];
    if (opts.sinceDays !== undefined) {
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
      wheres.push(
        `Date >= DateTime(${since.getUTCFullYear()},${since.getUTCMonth() + 1},${since.getUTCDate()})`,
      );
    }
    const json = await this.get<{ Invoices?: XeroInvoice[] }>("/Invoices", {
      where: wheres.join(" && "),
      order: "Date DESC",
    });
    return (json.Invoices ?? []).slice(0, opts.limit).map((i) => ({
      id: i.InvoiceID ?? "",
      vendor: i.Contact?.Name ?? null,
      category: null,
      amount_cents: Math.round(Number(i.Total ?? 0) * 100),
      currency: i.CurrencyCode ?? "GBP",
      date: parseXeroDate(i.Date) ?? new Date().toISOString(),
      description: i.Reference ?? null,
    }));
  }

  async listBalances(): Promise<Balance[]> {
    const json = await this.get<{ Accounts?: XeroAccount[] }>("/Accounts", {});
    return (json.Accounts ?? [])
      .filter((a) => a.Class === "ASSET" || a.Class === "LIABILITY" || a.Class === "EQUITY")
      .map((a) => ({
        account_id: a.AccountID ?? "",
        account_name: a.Name ?? "",
        account_type: (a.Type ?? "").toLowerCase(),
        balance_cents: 0, // Xero /Accounts doesn't include YTD balance; use Reports/BalanceSheet for real numbers
        currency: "GBP",
      }));
  }

  async listContacts(opts: {
    limit: number;
    role?: "customer" | "supplier";
  }): Promise<Contact[]> {
    const params: Record<string, string> = { order: "Name ASC" };
    if (opts.role === "customer") params.where = "IsCustomer==true";
    if (opts.role === "supplier") params.where = "IsSupplier==true";
    const json = await this.get<{ Contacts?: XeroContact[] }>("/Contacts", params);
    return (json.Contacts ?? []).slice(0, opts.limit).map((c) => ({
      id: c.ContactID ?? "",
      name: c.Name ?? "",
      email: c.EmailAddress ?? null,
      role:
        c.IsCustomer && c.IsSupplier
          ? "both"
          : c.IsCustomer
            ? "customer"
            : c.IsSupplier
              ? "supplier"
              : null,
    }));
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.ensureAccessToken();
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Xero-Tenant-Id": this.credentials.tenant_id ?? "",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Xero ${path} failed (${res.status}): ${text.slice(0, 200)}`);
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
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refresh_token!,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`Xero token refresh failed (${res.status})`);
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

type XeroInvoice = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Reference?: string;
  Contact?: { ContactID?: string; Name?: string };
  Total?: number;
  CurrencyCode?: string;
  Status?: string;
  Date?: string;
  DueDate?: string;
  FullyPaidOnDate?: string;
};

type XeroAccount = {
  AccountID?: string;
  Name?: string;
  Type?: string;
  Class?: string;
};

type XeroContact = {
  ContactID?: string;
  Name?: string;
  EmailAddress?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
};

function mapStatusToXero(s: InvoiceStatus): string {
  switch (s) {
    case "draft":
      return "DRAFT";
    case "sent":
      return "AUTHORISED";
    case "paid":
      return "PAID";
    case "overdue":
      return "AUTHORISED";
    case "void":
      return "VOIDED";
  }
}

function mapStatusFromXero(s: string | undefined): InvoiceStatus {
  switch (s) {
    case "DRAFT":
      return "draft";
    case "SUBMITTED":
    case "AUTHORISED":
      return "sent";
    case "PAID":
      return "paid";
    case "VOIDED":
    case "DELETED":
      return "void";
    default:
      return "sent";
  }
}

// Xero returns dates as "/Date(1737320400000+0000)/"
function parseXeroDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/\/Date\((\d+)/);
  if (!m) return null;
  return new Date(Number(m[1])).toISOString();
}
