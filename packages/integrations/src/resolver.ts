// Provider resolver — the single entry point for agents that need a
// third-party capability for a given user.
//
// Call `getEmailProvider(admin, userId)` and you get back whatever the user
// has connected (Gmail today; Outlook/IMAP when implemented). The resolver
// wires credential persistence so token refreshes flow back to the DB.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailProvider } from "./email/provider";
import { GmailProvider, type GmailCredentials } from "./email/gmail";
import type { PaymentProvider } from "./payment/provider";
import { StripeProvider, type StripeCredentials } from "./payment/stripe";
import { PayPalProvider, type PayPalCredentials } from "./payment/paypal";
import { SquareProvider, type SquareCredentials } from "./payment/square";
import type { SmartHomeProvider } from "./home/provider";
import { SmartThingsProvider, type SmartThingsCredentials } from "./home/smartthings";
import type { BankingProvider } from "./banking/provider";
import { MonzoProvider, type MonzoCredentials } from "./banking/monzo";
import {
  TrueLayerProvider,
  type TrueLayerCredentials,
  type TrueLayerEnv,
} from "./banking/truelayer";
import type { CryptoProvider } from "./crypto/provider";
import { CoinbaseProvider, type CoinbaseCredentials } from "./crypto/coinbase";
import { KrakenProvider, type KrakenCredentials } from "./crypto/kraken";
import type { CommerceProvider } from "./commerce/provider";
import { ShopifyProvider, type ShopifyCredentials } from "./commerce/shopify";
import type { AccountingProvider } from "./accounting/provider";
import { XeroProvider, type XeroCredentials } from "./accounting/xero";
import {
  QuickBooksProvider,
  type QuickBooksCredentials,
} from "./accounting/quickbooks";
import {
  FreeAgentProvider,
  type FreeAgentCredentials,
} from "./accounting/freeagent";
import type { ProductivityProvider } from "./productivity/provider";
import { NotionProvider, type NotionCredentials } from "./productivity/notion";
import type { DevProvider } from "./dev/provider";
import { GitHubProvider, type GitHubCredentials } from "./dev/github";
import type { MessagingProvider } from "./messaging/provider";
import { SlackProvider, type SlackCredentials } from "./messaging/slack";
import type { CalendarProvider } from "./calendar/provider";
import { CalComProvider, type CalComCredentials } from "./calendar/calcom";
import type { TasksProvider } from "./tasks/provider";
import { LinearProvider, type LinearCredentials } from "./tasks/linear";
import { TodoistProvider, type TodoistCredentials } from "./tasks/todoist";
import type { TransactionalProvider } from "./transactional/provider";
import { ResendProvider, type ResendCredentials } from "./transactional/resend";
import type { FilesProvider } from "./files/provider";
import {
  GoogleDriveProvider,
  type GoogleDriveCredentials,
} from "./files/googledrive";
import { PlaidProvider, type PlaidCredentials, type PlaidEnv } from "./banking/plaid";
import type { IntegrationRow, IntegrationKind } from "./types";

export async function getEmailProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<EmailProvider> {
  const row = await loadActive(admin, userId, "email", preferredProvider);
  switch (row.provider) {
    case "gmail":
      return createGmailFromRow(admin, row);
    default:
      throw new Error(`Unsupported email provider: ${row.provider}`);
  }
}

export async function getPaymentProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<PaymentProvider> {
  const row = await loadActive(admin, userId, "payment", preferredProvider);
  switch (row.provider) {
    case "stripe":
      return new StripeProvider({ credentials: row.credentials as StripeCredentials });
    case "paypal":
      return new PayPalProvider({ credentials: row.credentials as PayPalCredentials });
    case "square":
      return new SquareProvider({ credentials: row.credentials as SquareCredentials });
    default:
      throw new Error(`Unsupported payment provider: ${row.provider}`);
  }
}

export async function getBankingProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<BankingProvider> {
  const row = await loadActive(admin, userId, "banking", preferredProvider);
  switch (row.provider) {
    case "monzo":
      return createMonzoFromRow(admin, row);
    case "truelayer":
      return createTrueLayerFromRow(admin, row);
    case "plaid":
      return createPlaidFromRow(row);
    default:
      throw new Error(`Unsupported banking provider: ${row.provider}`);
  }
}

export async function getCryptoProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<CryptoProvider> {
  const row = await loadActive(admin, userId, "crypto", preferredProvider);
  switch (row.provider) {
    case "coinbase":
      return createCoinbaseFromRow(admin, row);
    case "kraken":
      return new KrakenProvider({
        credentials: row.credentials as KrakenCredentials,
      });
    default:
      throw new Error(`Unsupported crypto provider: ${row.provider}`);
  }
}

export async function getSmartHomeProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<SmartHomeProvider> {
  const row = await loadActive(admin, userId, "home", preferredProvider);
  switch (row.provider) {
    case "smartthings":
      return new SmartThingsProvider({
        credentials: row.credentials as SmartThingsCredentials,
      });
    default:
      throw new Error(`Unsupported home provider: ${row.provider}`);
  }
}

export async function getCommerceProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<CommerceProvider> {
  const row = await loadActive(admin, userId, "commerce", preferredProvider);
  switch (row.provider) {
    case "shopify":
      return new ShopifyProvider({ credentials: row.credentials as ShopifyCredentials });
    default:
      throw new Error(`Unsupported commerce provider: ${row.provider}`);
  }
}

export async function getProductivityProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<ProductivityProvider> {
  const row = await loadActive(admin, userId, "productivity", preferredProvider);
  switch (row.provider) {
    case "notion":
      return new NotionProvider({ credentials: row.credentials as NotionCredentials });
    default:
      throw new Error(`Unsupported productivity provider: ${row.provider}`);
  }
}

export async function getDevProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<DevProvider> {
  const row = await loadActive(admin, userId, "dev", preferredProvider);
  switch (row.provider) {
    case "github":
      return new GitHubProvider({ credentials: row.credentials as GitHubCredentials });
    default:
      throw new Error(`Unsupported dev provider: ${row.provider}`);
  }
}

export async function getMessagingProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<MessagingProvider> {
  const row = await loadActive(admin, userId, "messaging", preferredProvider);
  switch (row.provider) {
    case "slack":
      return new SlackProvider({ credentials: row.credentials as SlackCredentials });
    default:
      throw new Error(`Unsupported messaging provider: ${row.provider}`);
  }
}

export async function getCalendarProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<CalendarProvider> {
  const row = await loadActive(admin, userId, "calendar", preferredProvider);
  switch (row.provider) {
    case "calcom":
      return new CalComProvider({ credentials: row.credentials as CalComCredentials });
    default:
      throw new Error(`Unsupported calendar provider: ${row.provider}`);
  }
}

export async function getTasksProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<TasksProvider> {
  const row = await loadActive(admin, userId, "tasks", preferredProvider);
  switch (row.provider) {
    case "linear":
      return new LinearProvider({ credentials: row.credentials as LinearCredentials });
    case "todoist":
      return new TodoistProvider({ credentials: row.credentials as TodoistCredentials });
    default:
      throw new Error(`Unsupported tasks provider: ${row.provider}`);
  }
}

export async function getTransactionalProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<TransactionalProvider> {
  const row = await loadActive(admin, userId, "transactional", preferredProvider);
  switch (row.provider) {
    case "resend":
      return new ResendProvider({ credentials: row.credentials as ResendCredentials });
    default:
      throw new Error(`Unsupported transactional provider: ${row.provider}`);
  }
}

export async function getFilesProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<FilesProvider> {
  const row = await loadActive(admin, userId, "files", preferredProvider);
  switch (row.provider) {
    case "google_drive":
      return createGoogleDriveFromRow(admin, row);
    default:
      throw new Error(`Unsupported files provider: ${row.provider}`);
  }
}

export async function getAccountingProvider(
  admin: SupabaseClient,
  userId: string,
  preferredProvider?: string,
): Promise<AccountingProvider> {
  const row = await loadActive(admin, userId, "accounting", preferredProvider);
  switch (row.provider) {
    case "xero":
      return createXeroFromRow(admin, row);
    case "quickbooks":
      return createQuickBooksFromRow(admin, row);
    case "freeagent":
      return createFreeAgentFromRow(admin, row);
    default:
      throw new Error(`Unsupported accounting provider: ${row.provider}`);
  }
}

// List every active integration of a given kind. Used by callers that want
// to surface the list of connected providers (e.g. "stripe + paypal" for
// the brain to ask which one).
export async function listActiveIntegrations(
  admin: SupabaseClient,
  userId: string,
  kind: IntegrationKind,
): Promise<IntegrationRow[]> {
  const { data, error } = await admin
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to list ${kind} integrations: ${error.message}`);
  return (data ?? []) as IntegrationRow[];
}

async function loadActive(
  admin: SupabaseClient,
  userId: string,
  kind: IntegrationKind,
  preferredProvider?: string,
): Promise<IntegrationRow> {
  // If the caller specified a provider, look it up directly.
  if (preferredProvider) {
    const { data, error } = await admin
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("provider", preferredProvider)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load ${kind}/${preferredProvider} integration: ${error.message}`);
    }
    if (!data) {
      throw new Error(
        `No active ${kind} integration connected for provider '${preferredProvider}'`,
      );
    }
    return data as IntegrationRow;
  }

  // Otherwise: prefer the row marked is_default; fall back to the only
  // active row if there's exactly one (legacy single-provider users).
  const { data, error } = await admin
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("active", true);
  if (error) {
    throw new Error(`Failed to load ${kind} integration: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`No active ${kind} integration connected for user`);
  }
  const rows = data as IntegrationRow[];
  const defaultRow = rows.find((r) => r.is_default);
  if (defaultRow) return defaultRow;
  if (rows.length === 1) return rows[0]!;
  throw new Error(
    `Multiple active ${kind} providers connected (${rows
      .map((r) => r.provider)
      .join(", ")}) and none is marked default. Specify which provider to use.`,
  );
}

function createMonzoFromRow(admin: SupabaseClient, row: IntegrationRow): MonzoProvider {
  const clientId = process.env.MONZO_CLIENT_ID;
  const clientSecret = process.env.MONZO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MONZO_CLIENT_ID/SECRET not set — cannot create Monzo provider");
  }
  const creds = (row.credentials ?? {}) as MonzoCredentials;
  return new MonzoProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}

function createTrueLayerFromRow(
  admin: SupabaseClient,
  row: IntegrationRow,
): TrueLayerProvider {
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "TRUELAYER_CLIENT_ID/SECRET not set — cannot create TrueLayer provider",
    );
  }
  const env = (process.env.TRUELAYER_ENV as TrueLayerEnv | undefined) ?? "live";
  const creds = (row.credentials ?? {}) as TrueLayerCredentials;
  return new TrueLayerProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    env,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}

function createCoinbaseFromRow(
  admin: SupabaseClient,
  row: IntegrationRow,
): CoinbaseProvider {
  const clientId = process.env.COINBASE_CLIENT_ID;
  const clientSecret = process.env.COINBASE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "COINBASE_CLIENT_ID/SECRET not set — cannot create Coinbase provider",
    );
  }
  const creds = (row.credentials ?? {}) as CoinbaseCredentials;
  return new CoinbaseProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}

function createGmailFromRow(admin: SupabaseClient, row: IntegrationRow): GmailProvider {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET not set — cannot create Gmail provider");
  }
  const creds = (row.credentials ?? {}) as GmailCredentials;

  return new GmailProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}

function createXeroFromRow(admin: SupabaseClient, row: IntegrationRow): XeroProvider {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("XERO_CLIENT_ID/SECRET not set — cannot create Xero provider");
  }
  const creds = (row.credentials ?? {}) as XeroCredentials;
  return new XeroProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}

function createQuickBooksFromRow(
  admin: SupabaseClient,
  row: IntegrationRow,
): QuickBooksProvider {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "QUICKBOOKS_CLIENT_ID/SECRET not set — cannot create QuickBooks provider",
    );
  }
  const creds = (row.credentials ?? {}) as QuickBooksCredentials;
  return new QuickBooksProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}

function createPlaidFromRow(row: IntegrationRow): PlaidProvider {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = (process.env.PLAID_ENV as PlaidEnv | undefined) ?? "production";
  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID/SECRET not set — cannot create Plaid provider");
  }
  return new PlaidProvider({
    credentials: row.credentials as PlaidCredentials,
    env,
    clientId,
    secret,
  });
}

function createGoogleDriveFromRow(
  admin: SupabaseClient,
  row: IntegrationRow,
): GoogleDriveProvider {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID/SECRET not set — cannot create Google Drive provider",
    );
  }
  const creds = (row.credentials ?? {}) as GoogleDriveCredentials;
  return new GoogleDriveProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}

function createFreeAgentFromRow(
  admin: SupabaseClient,
  row: IntegrationRow,
): FreeAgentProvider {
  const clientId = process.env.FREEAGENT_CLIENT_ID;
  const clientSecret = process.env.FREEAGENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "FREEAGENT_CLIENT_ID/SECRET not set — cannot create FreeAgent provider",
    );
  }
  const creds = (row.credentials ?? {}) as FreeAgentCredentials;
  return new FreeAgentProvider({
    credentials: creds,
    expiresAt: row.expires_at,
    clientId,
    clientSecret,
    persist: async ({ credentials, expires_at }) => {
      await admin
        .from("integrations")
        .update({
          credentials,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    },
  });
}
