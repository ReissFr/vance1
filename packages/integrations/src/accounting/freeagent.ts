// FreeAgentProvider — AccountingProvider implementation backed by FreeAgent's
// OAuth2 API.

import type {
  AccountingProvider,
  Invoice,
  InvoiceStatus,
  Expense,
  Balance,
  Contact,
} from "./provider";

export type FreeAgentCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
};

export type FreeAgentPersistUpdate = {
  credentials: FreeAgentCredentials;
  expires_at: string;
};

export type FreeAgentProviderOptions = {
  credentials: FreeAgentCredentials;
  expiresAt: string | null;
  clientId: string;
  clientSecret: string;
  persist: (update: FreeAgentPersistUpdate) => Promise<void>;
};

const API_BASE = "https://api.freeagent.com/v2";
const TOKEN_URL = "https://api.freeagent.com/v2/token_endpoint";

export class FreeAgentProvider implements AccountingProvider {
  readonly providerName = "freeagent";

  private credentials: FreeAgentCredentials;
  private expiresAt: Date | null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly persist: (update: FreeAgentPersistUpdate) => Promise<void>;

  constructor(opts: FreeAgentProviderOptions) {
    if (!opts.credentials.access_token || !opts.credentials.refresh_token) {
      throw new Error("FreeAgent integration missing tokens");
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
      per_page: Math.min(opts.limit, 100).toString(),
      sort: "-dated_on",
    };
    if (opts.status) params.view = mapStatus(opts.status);
    if (opts.sinceDays !== undefined) {
      params.from_date = new Date(Date.now() - opts.sinceDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    const json = await this.get<{ invoices: FAInvoice[] }>("/invoices", params);
    return json.invoices.map(toInvoice);
  }

  async listExpenses(opts: {
    limit: number;
    sinceDays?: number;
  }): Promise<Expense[]> {
    const params: Record<string, string> = {
      per_page: Math.min(opts.limit, 100).toString(),
      sort: "-dated_on",
    };
    if (opts.sinceDays !== undefined) {
      params.from_date = new Date(Date.now() - opts.sinceDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    const json = await this.get<{ expenses: FAExpense[] }>("/expenses", params);
    return json.expenses.map((e) => ({
      id: e.url ?? "",
      vendor: null,
      category: e.category ?? null,
      amount_cents: Math.round(Number(e.gross_value ?? 0) * 100),
      currency: e.currency ?? "GBP",
      date: e.dated_on ?? new Date().toISOString(),
      description: e.description ?? null,
    }));
  }

  async listBalances(): Promise<Balance[]> {
    const json = await this.get<{ bank_accounts: FABankAccount[] }>(
      "/bank_accounts",
      {},
    );
    return json.bank_accounts.map((a) => ({
      account_id: a.url ?? "",
      account_name: a.name ?? "",
      account_type: a.type ?? "bank",
      balance_cents: Math.round(Number(a.current_balance ?? 0) * 100),
      currency: a.currency ?? "GBP",
    }));
  }

  async listContacts(opts: {
    limit: number;
    role?: "customer" | "supplier";
  }): Promise<Contact[]> {
    const json = await this.get<{ contacts: FAContact[] }>("/contacts", {
      per_page: Math.min(opts.limit, 100).toString(),
    });
    return json.contacts
      .filter((c) => {
        if (!opts.role) return true;
        if (opts.role === "customer") return c.status !== "Hidden";
        return true;
      })
      .slice(0, opts.limit)
      .map((c) => ({
        id: c.url ?? "",
        name:
          [c.first_name, c.last_name].filter(Boolean).join(" ") ||
          c.organisation_name ||
          "",
        email: c.email ?? null,
        role: opts.role ?? null,
      }));
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.ensureAccessToken();
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`FreeAgent ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private async ensureAccessToken(): Promise<string> {
    const skewMs = 30_000;
    if (this.expiresAt && this.expiresAt.getTime() - skewMs > Date.now()) {
      return this.credentials.access_token!;
    }
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refresh_token!,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`FreeAgent token refresh failed (${res.status})`);
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    const newExp = new Date(Date.now() + json.expires_in * 1000);
    this.credentials = {
      ...this.credentials,
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? this.credentials.refresh_token,
    };
    this.expiresAt = newExp;
    await this.persist({
      credentials: this.credentials,
      expires_at: newExp.toISOString(),
    });
    return json.access_token;
  }
}

type FAInvoice = {
  url?: string;
  reference?: string;
  contact?: string;
  contact_name?: string;
  net_value?: string;
  total_value?: string;
  currency?: string;
  status?: string;
  dated_on?: string;
  due_on?: string;
  paid_on?: string;
};

type FAExpense = {
  url?: string;
  category?: string;
  gross_value?: string;
  currency?: string;
  dated_on?: string;
  description?: string;
};

type FABankAccount = {
  url?: string;
  name?: string;
  type?: string;
  current_balance?: string;
  currency?: string;
};

type FAContact = {
  url?: string;
  first_name?: string;
  last_name?: string;
  organisation_name?: string;
  email?: string;
  status?: string;
};

function toInvoice(i: FAInvoice): Invoice {
  return {
    id: i.url ?? "",
    number: i.reference ?? null,
    customer_id: i.contact ?? null,
    customer_name: i.contact_name ?? null,
    amount_cents: Math.round(Number(i.total_value ?? 0) * 100),
    currency: i.currency ?? "GBP",
    status: mapStatusFrom(i.status),
    issued: i.dated_on ?? new Date().toISOString(),
    due: i.due_on ?? null,
    paid_at: i.paid_on ?? null,
  };
}

function mapStatus(s: InvoiceStatus): string {
  switch (s) {
    case "draft":
      return "draft";
    case "sent":
      return "open";
    case "paid":
      return "paid";
    case "overdue":
      return "overdue";
    case "void":
      return "cancelled";
  }
}

function mapStatusFrom(s: string | undefined): InvoiceStatus {
  switch ((s ?? "").toLowerCase()) {
    case "draft":
      return "draft";
    case "open":
    case "scheduled_to_email":
    case "sent":
      return "sent";
    case "paid":
      return "paid";
    case "overdue":
      return "overdue";
    case "cancelled":
      return "void";
    default:
      return "sent";
  }
}
