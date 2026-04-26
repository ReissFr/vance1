// FlyBrowserProvider — connects over CDP to a remote headless Chromium
// running on a Fly.io machine. Scaffolding: the provider is implemented and
// correctly plugs into the provider registry, but to actually run it you
// need to (a) deploy the Fly app using docker/browser-node/ and (b) set
// JARVIS_BROWSER=fly + JARVIS_FLY_CDP_URL=wss://<app>.fly.dev:<port>
// (single-tenant mode), or implement per-user machine lookup in
// resolveEndpoint() when Step 4 wires per-user profiles.
//
// Why this shape: running the browser in cloud means (1) JARVIS keeps
// working for tasks when the user's laptop is closed, (2) if this becomes a
// SaaS, each paying customer gets their own isolated Fly machine + persistent
// volume. CDP (connectOverCDP) is the simplest stable API — no remote-runner
// binary on our side of the wire, just Playwright talking to Chromium.

import { chromium, type BrowserContext, type Page } from "playwright";
import type {
  BrowserAction,
  BrowserExecContext,
  BrowserProvider,
  BrowserResult,
} from "./types";
import { resolveUserEndpoint } from "./registry";

async function resolveCdpUrl(ctx?: BrowserExecContext): Promise<string> {
  const ep = await resolveUserEndpoint(ctx?.userId);
  if (ep.cdpUrl) return ep.cdpUrl;
  throw new Error(
    "FlyBrowserProvider: no CDP URL. Either provision a row in browser_machines for this user, or set JARVIS_FLY_CDP_URL in env for single-tenant mode.",
  );
}

export class FlyBrowserProvider implements BrowserProvider {
  readonly name = "fly";
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastCdpUrl: string | null = null;

  async close(): Promise<void> {
    if (this.context) {
      const browser = this.context.browser();
      await this.context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
    this.context = null;
    this.page = null;
  }

  async execute(
    action: BrowserAction,
    ctx?: BrowserExecContext,
  ): Promise<BrowserResult> {
    try {
      if (action.type === "close") {
        await this.close();
        return { ok: true, output: "browser closed" };
      }

      const p = await this.ensurePage(ctx);

      switch (action.type) {
        case "open": {
          await p.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await p.waitForTimeout(800);
          return { ok: true, url: p.url(), title: await p.title() };
        }
        case "screenshot": {
          const buf = await p.screenshot({ type: "jpeg", quality: 70, fullPage: false });
          return { ok: true, imageB64: buf.toString("base64"), url: p.url() };
        }
        case "read": {
          const text = (await p.innerText("body").catch(() => "")) ?? "";
          return { ok: true, output: text.slice(0, 5000), url: p.url() };
        }
        case "status": {
          const hasPasswordInput = await p
            .evaluate(() => {
              const pw = Array.from(
                document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
              );
              return pw.some((el) => {
                const r = el.getBoundingClientRect();
                return r.width >= 4 && r.height >= 4;
              });
            })
            .catch(() => false);
          return {
            ok: true,
            url: p.url(),
            title: await p.title().catch(() => ""),
            hasPasswordInput,
          };
        }
        case "wait": {
          await p.waitForTimeout(action.seconds * 1000);
          return { ok: true, output: `waited ${action.seconds}s` };
        }
        case "back": {
          await p.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
          return { ok: true, url: p.url() };
        }
        case "forward": {
          await p.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
          return { ok: true, url: p.url() };
        }
        // The rich read/click_id/type_in flow from LocalBrowserProvider
        // depends on injecting data-jarvis-id attrs and visible-element
        // filtering. That logic is stable and can be lifted verbatim once
        // Fly is being used for real workloads — left as TODO so the stub
        // still typechecks without duplicating 80 lines of DOM JS twice.
        case "click":
        case "click_id":
        case "click_xy":
        case "type":
        case "type_in":
        case "press":
        case "scroll":
          return {
            ok: false,
            output: `fly provider: action "${action.type}" not yet implemented — deploy docker/browser-node and either port the local DOM walker or use Browserbase.`,
          };
      }
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err) };
    }
    return { ok: false, output: "unreachable" };
  }

  private async ensurePage(ctx?: BrowserExecContext): Promise<Page> {
    const cdpUrl = await resolveCdpUrl(ctx);
    if (this.context && this.lastCdpUrl !== cdpUrl) {
      await this.close();
    }
    if (!this.context) {
      const browser = await chromium.connectOverCDP(cdpUrl);
      const contexts = browser.contexts();
      this.context = contexts.length > 0 ? contexts[0]! : await browser.newContext();
      this.lastCdpUrl = cdpUrl;
      this.page = null;
    }
    if (!this.page || this.page.isClosed()) {
      const existing = this.context.pages();
      this.page = existing.length > 0 ? existing[0]! : await this.context.newPage();
    }
    return this.page;
  }
}
