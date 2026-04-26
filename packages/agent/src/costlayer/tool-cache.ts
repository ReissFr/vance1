import { createHash } from "node:crypto";

// In-memory cache of tool results, keyed on (userId, tool, stringified args).
// Tools that return time-sensitive data have short TTLs; stable ones longer.
// This is process-local — no cross-process sharing. Good enough to dedupe
// within a single conversation and the 5-minute Anthropic cache window.

interface Entry {
  value: unknown;
  userId: string;
  tool: string;
  expiresAt: number;
}

const CACHE = new Map<string, Entry>();
const MAX_ENTRIES = 2000;

// Per-tool TTLs in seconds. Anything not listed here is not cached.
// Conservative defaults: anything remotely user-action-dependent (writes,
// sends, installs) MUST NOT be here.
export const TOOL_TTL_SECONDS: Record<string, number> = {
  // Payments / banking — near-realtime numbers, cache briefly.
  payments_revenue: 60,
  payments_customers: 60,
  payments_charges: 30,
  payments_subscriptions: 120,
  banking_accounts: 120,
  banking_transactions: 60,
  banking_spending: 120,

  // Commerce (online store) — order stream is live, so keep short.
  commerce_orders: 30,
  commerce_products: 300,
  commerce_low_stock: 120,
  commerce_sales: 120,

  // Accounting — invoices/balances change slower than payments.
  accounting_invoices: 120,
  accounting_expenses: 120,
  accounting_balances: 120,
  accounting_contacts: 600,

  // Crypto. Balances shift with market price, so short TTLs.
  crypto_wallets: 60,
  crypto_portfolio: 60,
  crypto_transactions: 60,
  // Whitelist reads are stable — the only writer is crypto_save_address,
  // which invalidates via INVALIDATIONS below.
  crypto_list_addresses: 300,
  // list_pending_crypto_actions changes the moment a task settles, so
  // we deliberately do NOT cache it.

  // Mailbox / calendar reads. Short cache; users expect freshness.
  list_emails: 30,
  list_calendar_events: 120,
  list_meetings: 120,

  // Static-ish info.
  weather: 600,           // 10 min
  hackernews_top: 600,
  news_headlines: 600,
  home_list_devices: 60,

  // Skill catalogue — rarely changes within a session.
  find_skill: 300,

  // Browser reads on the *current* page are NOT cached — DOM changes every
  // click. Similarly browser_screenshot.
};

// Writes that should invalidate specific read caches.
const INVALIDATIONS: Record<string, string[]> = {
  create_calendar_event: ["list_calendar_events"],
  draft_email: ["list_emails"],
  home_control_device: ["home_list_devices"],
  crypto_save_address: ["crypto_list_addresses"],
  // A completed crypto_send shifts balances — bust wallet/portfolio caches.
  crypto_action_respond: ["crypto_wallets", "crypto_portfolio", "crypto_transactions"],
};

function keyFor(userId: string, tool: string, input: unknown): string {
  const stable = JSON.stringify(input, Object.keys(input ?? {}).sort());
  return createHash("sha256").update(`${userId}|${tool}|${stable}`).digest("hex").slice(0, 24);
}

function evictOldestIfFull(): void {
  if (CACHE.size < MAX_ENTRIES) return;
  const first = CACHE.keys().next().value;
  if (first) CACHE.delete(first);
}

export function lookupToolResult(userId: string, tool: string, input: unknown): unknown | undefined {
  const ttl = TOOL_TTL_SECONDS[tool];
  if (!ttl) return undefined;
  const key = keyFor(userId, tool, input);
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    CACHE.delete(key);
    return undefined;
  }
  return hit.value;
}

export function rememberToolResult(userId: string, tool: string, input: unknown, value: unknown): void {
  const ttl = TOOL_TTL_SECONDS[tool];
  if (!ttl) return;
  evictOldestIfFull();
  const key = keyFor(userId, tool, input);
  CACHE.set(key, { value, userId, tool, expiresAt: Date.now() + ttl * 1000 });
}

export function invalidateForWrite(userId: string, tool: string): void {
  const affected = INVALIDATIONS[tool];
  if (!affected || affected.length === 0) return;
  const affectedSet = new Set(affected);
  for (const [key, entry] of CACHE.entries()) {
    if (entry.userId === userId && affectedSet.has(entry.tool)) CACHE.delete(key);
  }
}
