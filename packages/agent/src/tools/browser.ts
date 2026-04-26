import { z } from "zod";
import { defineTool } from "./types";
import type { BrowserAction, BrowserResult, ToolContext } from "./types";

// Playwright-backed browser tools. The brain uses these to drive a real
// Chromium instance — navigating, clicking, typing, reading pages, taking
// screenshots. Works reliably (unlike OS-level computer use) because
// Playwright is purpose-built for automation.

async function run(ctx: ToolContext, action: BrowserAction): Promise<BrowserResult> {
  if (!ctx.executeBrowserAction) {
    return { ok: false, output: "browser not available in this context" };
  }
  return ctx.executeBrowserAction(action);
}

export const browserOpenTool = defineTool({
  name: "browser_open",
  description:
    "Navigate the browser to a URL. Use this to start any web task — flights, shopping, research, forms, logins, bookings. Opens a real Chromium window that the user can see. After opening, use browser_screenshot or browser_read to see what's on the page.",
  schema: z.object({ url: z.string().url() }),
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", description: "Full http(s) URL to navigate to." } },
    required: ["url"],
  },
  async run(input, ctx) {
    return run(ctx, { type: "open", url: input.url });
  },
});

export const browserScreenshotTool = defineTool({
  name: "browser_screenshot",
  description:
    "Take a screenshot of the current browser page. Use this to see the page visually — buttons, layout, images, forms. Returns a JPEG you can reason about. Call this after navigating or clicking to verify what's on screen before the next action.",
  schema: z.object({}),
  inputSchema: { type: "object", properties: {}, required: [] },
  async run(_input, ctx) {
    return run(ctx, { type: "screenshot" });
  },
});

export const browserReadTool = defineTool({
  name: "browser_read",
  description:
    "Read the current browser page. Returns: (1) a numbered list of every interactive element on the page — buttons, links, inputs, selects — each with a stable [id], its kind, and its label; (2) the visible text below. ALWAYS call this after navigating or clicking, then use the [id] numbers with browser_click and browser_type — that's the reliable path. Cookie banners are dismissed automatically.",
  schema: z.object({}),
  inputSchema: { type: "object", properties: {}, required: [] },
  async run(_input, ctx) {
    return run(ctx, { type: "read" });
  },
});

export const browserClickTool = defineTool({
  name: "browser_click",
  description:
    "Click an element on the current browser page. STRONGLY PREFER passing `id` (the number from browser_read's INTERACTIVE ELEMENTS list) — that's the reliable path. Fall back to `target` (text or CSS selector) only when no id is available. The IDs are valid until the next browser_read.",
  schema: z
    .object({
      id: z.number().int().positive().optional(),
      target: z.string().min(1).optional(),
      nth: z.number().int().min(0).optional(),
    })
    .refine((v) => v.id !== undefined || v.target !== undefined, {
      message: "Provide either id or target",
    }),
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description:
          "Preferred. The [id] number from the most recent browser_read INTERACTIVE ELEMENTS list.",
      },
      target: {
        type: "string",
        description:
          "Fallback only. Button/link text ('Sign in'), placeholder ('Search'), label ('Email'), or CSS selector ('#id', '.class').",
      },
      nth: {
        type: "number",
        description: "If using target and multiple match, pick the Nth (0-indexed). Defaults to 0.",
      },
    },
  },
  async run(input, ctx) {
    if (input.id !== undefined) return run(ctx, { type: "click_id", id: input.id });
    return run(ctx, {
      type: "click",
      target: input.target!,
      ...(input.nth !== undefined ? { nth: input.nth } : {}),
    });
  },
});

export const browserTypeTool = defineTool({
  name: "browser_type",
  description:
    "Type text into a form field on the current browser page. STRONGLY PREFER passing `id` (the number from browser_read's INTERACTIVE ELEMENTS list for an input/textarea) — clicks and fills it in one shot, much more reliable. Without `id`, types into whatever is currently focused. Set submit=true to press Enter after (good for search boxes).",
  schema: z
    .object({
      id: z.number().int().positive().optional(),
      text: z.string().min(1),
      submit: z.boolean().optional(),
    }),
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description:
          "Preferred. The [id] of the input/textarea from the most recent browser_read.",
      },
      text: { type: "string", description: "Text to type." },
      submit: {
        type: "boolean",
        description: "If true, press Enter after typing. Useful for search boxes.",
      },
    },
    required: ["text"],
  },
  async run(input, ctx) {
    if (input.id !== undefined) {
      return run(ctx, {
        type: "type_in",
        id: input.id,
        text: input.text,
        ...(input.submit !== undefined ? { submit: input.submit } : {}),
      });
    }
    return run(ctx, {
      type: "type",
      text: input.text,
      ...(input.submit !== undefined ? { submit: input.submit } : {}),
    });
  },
});

export const browserPressTool = defineTool({
  name: "browser_press",
  description:
    "Press a key in the browser. Examples: 'Enter', 'Escape', 'Tab', 'ArrowDown', 'Control+A'. Follows Playwright's key naming.",
  schema: z.object({ key: z.string().min(1) }),
  inputSchema: {
    type: "object",
    properties: { key: { type: "string", description: "Key name, e.g. 'Enter', 'Escape', 'Tab'." } },
    required: ["key"],
  },
  async run(input, ctx) {
    return run(ctx, { type: "press", key: input.key });
  },
});

export const browserScrollTool = defineTool({
  name: "browser_scroll",
  description:
    "Scroll the current browser page up or down. Default is 600 pixels. Use to reveal content below the fold, page through search results, or view a long article.",
  schema: z.object({
    direction: z.enum(["up", "down"]),
    amount: z.number().int().positive().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["up", "down"] },
      amount: { type: "number", description: "Pixels. Default 600." },
    },
    required: ["direction"],
  },
  async run(input, ctx) {
    return run(ctx, { type: "scroll", direction: input.direction, ...(input.amount !== undefined ? { amount: input.amount } : {}) });
  },
});

export const browserBackTool = defineTool({
  name: "browser_back",
  description: "Navigate back one page in the browser's history.",
  schema: z.object({}),
  inputSchema: { type: "object", properties: {}, required: [] },
  async run(_input, ctx) {
    return run(ctx, { type: "back" });
  },
});

export const browserWaitTool = defineTool({
  name: "browser_wait",
  description:
    "Wait a few seconds. Use sparingly — only when a page is loading dynamic content and a read/screenshot returned nothing useful. Max 10 seconds.",
  schema: z.object({ seconds: z.number().min(1).max(10) }),
  inputSchema: {
    type: "object",
    properties: { seconds: { type: "number", description: "Seconds to wait (1-10)." } },
    required: ["seconds"],
  },
  async run(input, ctx) {
    return run(ctx, { type: "wait", seconds: input.seconds });
  },
});
