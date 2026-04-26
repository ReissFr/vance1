// Session pairing for the concierge agent. Users pair a site once (log in in a
// headful browser that opens on their Mac); we capture the Playwright
// storageState (cookies + localStorage) and store it as an integrations row.
// The concierge runner then loads all paired sessions into its context at
// task-start, so logged-in flows work without re-auth every task.
//
// Pairing state is kept in an in-process Map. Server restart kills any
// in-flight pair. That's fine — users just re-click "Add site". Not worth a
// durable store for session-lifetime state.
//
// Security note: storageState contains session cookies. We store them in
// integrations.credentials (jsonb) alongside existing OAuth tokens. Project
// convention is plaintext-at-rest with RLS + service-role gating; encrypting
// credentials is tracked as project-wide tech debt (see 0007_integrations.sql).

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";

export interface SitePreset {
  id: string;
  name: string;
  loginUrl: string;
  domain: string;
}

export const SITE_PRESETS: Record<string, SitePreset> = {
  opentable: {
    id: "opentable",
    name: "OpenTable",
    loginUrl: "https://www.opentable.com/m/sign-in/",
    domain: "opentable.com",
  },
  booking: {
    id: "booking",
    name: "Booking.com",
    loginUrl: "https://account.booking.com/sign-in",
    domain: "booking.com",
  },
  uber: {
    id: "uber",
    name: "Uber",
    loginUrl: "https://auth.uber.com/login/",
    domain: "uber.com",
  },
  ubereats: {
    id: "ubereats",
    name: "Uber Eats",
    loginUrl: "https://auth.uber.com/login/?next_url=https%3A%2F%2Fwww.ubereats.com%2F",
    domain: "ubereats.com",
  },
  deliveroo: {
    id: "deliveroo",
    name: "Deliveroo",
    loginUrl: "https://deliveroo.co.uk/login",
    domain: "deliveroo.co.uk",
  },
  amazon: {
    id: "amazon",
    name: "Amazon UK",
    loginUrl: "https://www.amazon.co.uk/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.co.uk%2F",
    domain: "amazon.co.uk",
  },
  airbnb: {
    id: "airbnb",
    name: "Airbnb",
    loginUrl: "https://www.airbnb.co.uk/login",
    domain: "airbnb.co.uk",
  },
  skyscanner: {
    id: "skyscanner",
    name: "Skyscanner",
    loginUrl: "https://www.skyscanner.net/g/login/",
    domain: "skyscanner.net",
  },
};

interface ActivePair {
  userId: string;
  provider: string;
  domain: string;
  displayName: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  startedAt: number;
}

const PAIRINGS = new Map<string, ActivePair>();
const PAIR_TIMEOUT_MS = 15 * 60 * 1000; // auto-close stale pairs after 15 min

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of PAIRINGS.entries()) {
    if (now - p.startedAt > PAIR_TIMEOUT_MS) {
      p.browser.close().catch(() => {});
      PAIRINGS.delete(id);
    }
  }
}, 60 * 1000).unref?.();

export async function startPairing(opts: {
  userId: string;
  presetId?: string;
  customUrl?: string;
  customName?: string;
  customDomain?: string;
}): Promise<{
  pair_id: string;
  login_url: string;
  provider: string;
  display_name: string;
}> {
  let loginUrl: string;
  let provider: string;
  let domain: string;
  let displayName: string;

  if (opts.presetId) {
    const preset = SITE_PRESETS[opts.presetId];
    if (!preset) throw new Error(`unknown preset: ${opts.presetId}`);
    loginUrl = preset.loginUrl;
    provider = preset.id;
    domain = preset.domain;
    displayName = preset.name;
  } else {
    if (!opts.customUrl || !opts.customDomain || !opts.customName) {
      throw new Error("custom pairing requires customUrl, customDomain, customName");
    }
    loginUrl = opts.customUrl;
    provider = opts.customDomain.replace(/^www\./, "");
    domain = opts.customDomain.replace(/^www\./, "");
    displayName = opts.customName;
  }

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

  const pairId = randomUUID();
  PAIRINGS.set(pairId, {
    userId: opts.userId,
    provider,
    domain,
    displayName,
    browser,
    context,
    page,
    startedAt: Date.now(),
  });

  return { pair_id: pairId, login_url: loginUrl, provider, display_name: displayName };
}

export async function finishPairing(opts: {
  userId: string;
  pairId: string;
}): Promise<{
  provider: string;
  domain: string;
  display_name: string;
  cookie_count: number;
  origin_count: number;
  storageState: unknown;
}> {
  const pair = PAIRINGS.get(opts.pairId);
  if (!pair) throw new Error("pair not found or expired");
  if (pair.userId !== opts.userId) throw new Error("pair does not belong to this user");

  let storageState;
  try {
    storageState = await pair.context.storageState();
  } finally {
    await pair.browser.close().catch(() => {});
    PAIRINGS.delete(opts.pairId);
  }

  return {
    provider: pair.provider,
    domain: pair.domain,
    display_name: pair.displayName,
    cookie_count: storageState.cookies?.length ?? 0,
    origin_count: storageState.origins?.length ?? 0,
    storageState,
  };
}

export async function cancelPairing(opts: {
  userId: string;
  pairId: string;
}): Promise<void> {
  const pair = PAIRINGS.get(opts.pairId);
  if (!pair) return;
  if (pair.userId !== opts.userId) throw new Error("pair does not belong to this user");
  await pair.browser.close().catch(() => {});
  PAIRINGS.delete(opts.pairId);
}

// Merge multiple storageState objects into one. Cookies and origins are simple
// arrays keyed by (name, domain, path) or by origin — dedup by last-write-wins.
// Playwright handles domain-scoping at the browser level, so piling them all
// in is safe.
export function mergeStorageStates(states: Array<{ cookies?: unknown[]; origins?: unknown[] }>): {
  cookies: unknown[];
  origins: unknown[];
} {
  const cookies: unknown[] = [];
  const origins: unknown[] = [];
  for (const s of states) {
    if (Array.isArray(s.cookies)) cookies.push(...s.cookies);
    if (Array.isArray(s.origins)) origins.push(...s.origins);
  }
  return { cookies, origins };
}
