// BrowserProvider — the pluggable interface behind every call that drives
// a headful/headless browser on behalf of JARVIS. A "provider" is one
// execution backend: local Playwright on this machine (LocalBrowserProvider),
// a self-hosted cloud node on Fly.io (FlyBrowserProvider — scaffolded next),
// or a managed service like Browserbase (not yet implemented).
//
// The whole point: brain/route code should import `executeBrowserAction`
// from `@/lib/browser` and never know which backend runs the work. Selection
// happens at startup via env. Per-user routing (e.g. SaaS tenant → their own
// Fly machine) lives in the provider registry, not in call sites.

import type { BrowserAction, BrowserResult } from "@jarvis/agent";

export type { BrowserAction, BrowserResult };

export interface BrowserExecContext {
  // The JARVIS user this action runs on behalf of. Providers that carry
  // per-user state (profile directory, cloud machine handle, cookies) key
  // on this. Optional for now — Step 4 wires it through call sites.
  userId?: string;
}

export interface BrowserProvider {
  readonly name: string;
  execute(
    action: BrowserAction,
    ctx?: BrowserExecContext,
  ): Promise<BrowserResult>;
  // Graceful shutdown — called on server stop, or when switching provider.
  close(): Promise<void>;
}
