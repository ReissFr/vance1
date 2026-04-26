// Provider selection + a singleton instance. Call sites import
// `executeBrowserAction` from `@/lib/browser` — that resolves here. Choosing
// a backend is an env-flag decision at boot.

import type {
  BrowserAction,
  BrowserExecContext,
  BrowserProvider,
  BrowserResult,
} from "./types";
import { LocalBrowserProvider } from "./local";
import { FlyBrowserProvider } from "./fly";

export type { BrowserProvider, BrowserAction, BrowserResult, BrowserExecContext };

let provider: BrowserProvider | null = null;

function resolveProvider(): BrowserProvider {
  // Right now we only ship the local provider. FlyBrowserProvider lands in
  // Step 3; Browserbase could slot in later. Switch via JARVIS_BROWSER=local
  // (default) / fly / browserbase when those exist.
  const kind = (process.env.JARVIS_BROWSER ?? "local").toLowerCase();
  switch (kind) {
    case "local":
      return new LocalBrowserProvider();
    case "fly":
      return new FlyBrowserProvider();
    default:
      console.warn(
        `[browser-providers] unknown JARVIS_BROWSER="${kind}" — falling back to local`,
      );
      return new LocalBrowserProvider();
  }
}

export function getBrowserProvider(): BrowserProvider {
  if (!provider) provider = resolveProvider();
  return provider;
}

export async function executeBrowserAction(
  action: BrowserAction,
  ctx?: BrowserExecContext,
): Promise<BrowserResult> {
  return getBrowserProvider().execute(action, ctx);
}

export async function closeBrowserProvider(): Promise<void> {
  if (provider) {
    await provider.close();
    provider = null;
  }
}
