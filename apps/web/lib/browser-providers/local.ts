// LocalBrowserProvider — drives Playwright on the same machine this Next.js
// process runs on. Headful by default so the user (or a pre-sign-in flow)
// can see what's happening. Persistent user profile at ~/.jarvis/browser-profile
// so cookies/logins survive.
//
// HMR SURVIVAL: Next.js dev-server reloads kill the in-memory context on
// file changes, but the Chromium process keeps running and holds a profile
// lock. We launch with remote debugging enabled; on re-entry we try
// connectOverCDP via the port Chromium wrote to DevToolsActivePort. If that
// fails, we clean the stale SingletonLock and launch fresh.

import { chromium, type BrowserContext, type Page } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  unlinkSync,
  readlinkSync,
} from "node:fs";
import type {
  BrowserAction,
  BrowserExecContext,
  BrowserProvider,
  BrowserResult,
} from "./types";

const PROFILE_DIR = join(homedir(), ".jarvis", "browser-profile");
const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--remote-debugging-port=0",
];

function readDevToolsPort(): number | null {
  const file = join(PROFILE_DIR, "DevToolsActivePort");
  if (!existsSync(file)) return null;
  try {
    const content = readFileSync(file, "utf8");
    const firstLine = content.split("\n")[0] ?? "";
    const n = parseInt(firstLine, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function cleanStaleLock() {
  // SingletonLock is a symlink whose target is "hostname-PID". If the PID
  // isn't alive, delete it. Never delete a live lock — would corrupt a
  // running Chromium.
  const lockPath = join(PROFILE_DIR, "SingletonLock");
  if (!existsSync(lockPath)) return;
  try {
    const target = readlinkSync(lockPath);
    const pid = parseInt(target.split("-").pop() ?? "", 10);
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        return;
      } catch {
        /* not alive → stale */
      }
    }
  } catch {
    /* unreadable link → treat as stale */
  }
  try { unlinkSync(lockPath); } catch {}
  try { unlinkSync(join(PROFILE_DIR, "SingletonCookie")); } catch {}
  try { unlinkSync(join(PROFILE_DIR, "SingletonSocket")); } catch {}
}

export class LocalBrowserProvider implements BrowserProvider {
  readonly name = "local";
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
    }
    this.context = null;
    this.page = null;
  }

  async execute(
    action: BrowserAction,
    _ctx?: BrowserExecContext,
  ): Promise<BrowserResult> {
    try {
      if (action.type === "close") {
        await this.close();
        return { ok: true, output: "browser closed" };
      }

      const p = await this.ensurePage();

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
        case "click": {
          const target = action.target.trim();
          const nth = action.nth ?? 0;
          const loc = resolveLocator(p, target, nth);
          await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          await loc.click({ timeout: 10000 });
          await p.waitForTimeout(600);
          return { ok: true, output: `clicked ${target}`, url: p.url() };
        }
        case "click_id": {
          const loc = p.locator(`[data-jarvis-id="${action.id}"]`);
          await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          await loc.click({ timeout: 10000 });
          await p.waitForTimeout(600);
          return { ok: true, output: `clicked id=${action.id}`, url: p.url() };
        }
        case "click_xy": {
          await p.mouse.click(action.x, action.y);
          await p.waitForTimeout(600);
          return { ok: true, output: `clicked (${action.x}, ${action.y})` };
        }
        case "type": {
          await p.keyboard.type(action.text, { delay: 20 });
          if (action.submit) {
            await p.keyboard.press("Enter");
            await p.waitForTimeout(1000);
          }
          return { ok: true, output: `typed ${action.text.length} chars` };
        }
        case "type_in": {
          const loc = p.locator(`[data-jarvis-id="${action.id}"]`);
          await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          await loc.click({ timeout: 10000 });
          await loc.fill(action.text, { timeout: 10000 });
          if (action.submit) {
            await p.keyboard.press("Enter");
            await p.waitForTimeout(1000);
          }
          return { ok: true, output: `typed into id=${action.id}`, url: p.url() };
        }
        case "press": {
          await p.keyboard.press(action.key);
          await p.waitForTimeout(400);
          return { ok: true, output: `pressed ${action.key}` };
        }
        case "scroll": {
          const amt = action.amount ?? 600;
          const dy = action.direction === "down" ? amt : -amt;
          await p.mouse.wheel(0, dy);
          await p.waitForTimeout(400);
          return { ok: true, output: `scrolled ${action.direction} ${amt}px` };
        }
        case "read": {
          await tryDismissCookieBanner(p);
          const { interactive, text } = await p.evaluate(() => {
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
            const body = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, 5000);
            return { interactive: items.join("\n"), text: body };
          });
          const out = `INTERACTIVE ELEMENTS (use these IDs with browser_click and browser_type):\n${interactive || "(none found)"}\n\n--- VISIBLE TEXT ---\n${text}`;
          return { ok: true, output: out, url: p.url(), title: await p.title() };
        }
        case "status": {
          const hasPasswordInput = await p
            .evaluate(() => {
              const pw = Array.from(
                document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
              );
              return pw.some((el) => {
                const r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) return false;
                const cs = getComputedStyle(el);
                return cs.visibility !== "hidden" && cs.display !== "none";
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
        case "back": {
          await p.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
          return { ok: true, url: p.url() };
        }
        case "forward": {
          await p.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
          return { ok: true, url: p.url() };
        }
        case "wait": {
          await p.waitForTimeout(action.seconds * 1000);
          return { ok: true, output: `waited ${action.seconds}s` };
        }
      }
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err) };
    }
    return { ok: false, output: "unreachable" };
  }

  private async ensurePage(): Promise<Page> {
    if (this.context) {
      try {
        this.context.pages();
      } catch {
        this.context = null;
        this.page = null;
      }
    }
    if (!this.context) {
      this.context = (await tryConnectExisting()) ?? (await launchFresh());
      this.page = null;
    }
    if (!this.page || this.page.isClosed()) {
      const existing = this.context.pages();
      this.page = existing.length > 0 ? existing[0]! : await this.context.newPage();
    }
    return this.page;
  }
}

async function tryConnectExisting(): Promise<BrowserContext | null> {
  const port = readDevToolsPort();
  if (!port) return null;
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    const contexts = browser.contexts();
    if (contexts.length === 0) return null;
    return contexts[0]!;
  } catch {
    return null;
  }
}

async function launchFresh(): Promise<BrowserContext> {
  mkdirSync(PROFILE_DIR, { recursive: true });
  cleanStaleLock();
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    args: LAUNCH_ARGS,
  });
}

async function tryDismissCookieBanner(page: Page): Promise<void> {
  const phrases = [
    "Accept all",
    "Accept All",
    "I agree",
    "Agree",
    "Allow all",
    "Got it",
    "OK",
    "Accept cookies",
    "Accept",
  ];
  for (const phrase of phrases) {
    const btn = page.getByRole("button", { name: phrase, exact: false }).first();
    if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
      await btn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }
}

function resolveLocator(page: Page, target: string, nth: number) {
  if (/^[#.\[]/.test(target) || />|:/.test(target)) {
    return page.locator(target).nth(nth);
  }
  const loc = page.getByRole("button", { name: target, exact: false })
    .or(page.getByRole("link", { name: target, exact: false }))
    .or(page.getByText(target, { exact: false }))
    .or(page.getByPlaceholder(target))
    .or(page.getByLabel(target));
  return loc.first().nth(nth);
}
