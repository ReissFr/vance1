// Headless Playwright harness for the concierge agent. Parallel to browser.ts
// (which runs headful on the user's Mac for interactive brain use) — this runs
// fully server-side, no display, per-task isolated. Persists cookies to disk
// per user so logins (Uber/OpenTable/Booking) survive across tasks.
//
// Cost note: we deliberately DO NOT expose a screenshot action to the agent
// loop. DOM-text + accessibility-tree output is ~10x cheaper per step than
// images and is plenty for form-driven bookings. If a task ever needs vision,
// escalate separately.

import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";

export type ConciergeAction =
  | { type: "navigate"; url: string }
  | { type: "read" }
  | { type: "click_id"; id: number }
  | { type: "type_in"; id: number; text: string; submit?: boolean }
  | { type: "press"; key: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "wait"; seconds: number }
  | { type: "back" };

export interface ConciergeResult {
  ok: boolean;
  output?: string;
  url?: string;
  title?: string;
}

export interface ConciergeBrowser {
  execute(action: ConciergeAction): Promise<ConciergeResult>;
  // Called by runner when a human approved an over-limit booking — clicks the
  // id the agent had flagged on the pre-existing page, without rerunning the
  // whole tool loop.
  clickByJarvisId(id: number): Promise<ConciergeResult>;
  storageState(): Promise<BrowserContextOptions["storageState"]>;
  close(): Promise<void>;
}

// One browser per task. Isolated contexts mean parallel concierge tasks don't
// stomp on each other's cookies. The caller passes a pre-merged storageState
// (from all the user's paired concierge_session integrations rows); the
// runner is responsible for loading + merging those states.
export async function openConciergeBrowser(opts: {
  storageState?: BrowserContextOptions["storageState"];
}): Promise<ConciergeBrowser> {
  const browser: Browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    storageState: opts.storageState,
  });
  const page: Page = await context.newPage();

  return {
    async execute(action) {
      try {
        switch (action.type) {
          case "navigate": {
            await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(600);
            await tryDismissCookieBanner(page);
            return { ok: true, url: page.url(), title: await page.title() };
          }
          case "read": {
            await tryDismissCookieBanner(page);
            const out = await readPage(page);
            return { ok: true, output: out, url: page.url(), title: await page.title() };
          }
          case "click_id": {
            const loc = page.locator(`[data-jarvis-id="${action.id}"]`);
            await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
            await loc.click({ timeout: 10000 });
            await page.waitForTimeout(600);
            return { ok: true, output: `clicked id=${action.id}`, url: page.url() };
          }
          case "type_in": {
            const loc = page.locator(`[data-jarvis-id="${action.id}"]`);
            await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
            await loc.click({ timeout: 10000 });
            await loc.fill(action.text, { timeout: 10000 });
            if (action.submit) {
              await page.keyboard.press("Enter");
              await page.waitForTimeout(1000);
            }
            return { ok: true, output: `typed into id=${action.id}`, url: page.url() };
          }
          case "press": {
            await page.keyboard.press(action.key);
            await page.waitForTimeout(400);
            return { ok: true, output: `pressed ${action.key}` };
          }
          case "scroll": {
            const amt = action.amount ?? 600;
            const dy = action.direction === "down" ? amt : -amt;
            await page.mouse.wheel(0, dy);
            await page.waitForTimeout(400);
            return { ok: true, output: `scrolled ${action.direction} ${amt}px` };
          }
          case "wait": {
            await page.waitForTimeout(Math.min(action.seconds, 10) * 1000);
            return { ok: true, output: `waited ${action.seconds}s` };
          }
          case "back": {
            await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
            return { ok: true, url: page.url() };
          }
        }
      } catch (err) {
        return { ok: false, output: err instanceof Error ? err.message : String(err) };
      }
    },
    async clickByJarvisId(id) {
      try {
        const loc = page.locator(`[data-jarvis-id="${id}"]`);
        await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await loc.click({ timeout: 10000 });
        await page.waitForTimeout(1500);
        return { ok: true, output: `clicked id=${id}`, url: page.url() };
      } catch (err) {
        return { ok: false, output: err instanceof Error ? err.message : String(err) };
      }
    },
    async storageState() {
      return context.storageState();
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function readPage(page: Page): Promise<string> {
  const { interactive, text } = await page.evaluate(() => {
    document
      .querySelectorAll("[data-jarvis-id]")
      .forEach((el) => el.removeAttribute("data-jarvis-id"));
    const sel =
      'a, button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [contenteditable="true"]';
    const all = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
    const visible = all.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return false;
      if ((el as HTMLInputElement).disabled) return false;
      return true;
    });
    const items: string[] = [];
    let id = 0;
    for (const el of visible) {
      id++;
      el.setAttribute("data-jarvis-id", String(id));
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");
      const kind = role || tag;
      let label = "";
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        label =
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          (el as HTMLInputElement).name ||
          (el as HTMLInputElement).type ||
          "";
        const v = (el as HTMLInputElement).value;
        if (v) label += ` (value: "${v.slice(0, 40)}")`;
      } else if (el instanceof HTMLSelectElement) {
        label = el.getAttribute("aria-label") || el.name || "select";
      } else {
        label =
          el.getAttribute("aria-label") ||
          (el.innerText || "").trim().slice(0, 80) ||
          el.getAttribute("title") ||
          el.getAttribute("alt") ||
          "";
      }
      label = label.replace(/\s+/g, " ").trim();
      if (!label) continue;
      const href = el.getAttribute("href");
      const extra = href && !href.startsWith("javascript:") ? ` -> ${href.slice(0, 60)}` : "";
      items.push(`[${id}] ${kind} "${label}"${extra}`);
      if (items.length >= 80) break;
    }
    const body = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, 4000);
    return { interactive: items.join("\n"), text: body };
  });
  return `INTERACTIVE ELEMENTS (use these IDs with click_id / type_in):\n${interactive || "(none found)"}\n\n--- VISIBLE TEXT ---\n${text}`;
}

async function tryDismissCookieBanner(page: Page): Promise<void> {
  const phrases = ["Accept all", "Accept All", "I agree", "Agree", "Allow all", "Got it", "OK", "Accept cookies", "Accept"];
  for (const phrase of phrases) {
    const btn = page.getByRole("button", { name: phrase, exact: false }).first();
    if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
      await btn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }
}
