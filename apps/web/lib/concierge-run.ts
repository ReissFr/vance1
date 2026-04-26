// Server-side runner for the concierge agent. Loads a queued concierge task,
// drives a headless Chromium with Claude in a tool loop, streams progress into
// task_events, writes a structured result, and pings the user when done.
//
// Cost-efficiency design:
//   - Haiku 4.5 as default driver (5x cheaper than Sonnet, plenty for form
//     navigation). Opus only as overload fallback.
//   - DOM text + interactive-element list per step (no screenshots) — ~10x
//     cheaper tokens than vision. Form bookings don't need pixels.
//   - Step budget: default 25. Hard stop. Tasks that need more usually mean
//     the agent is lost; failing fast is cheaper than letting it spin.
//   - Persistent storage state per user means logins (when added) survive
//     between tasks; no re-auth steps burned on every run.
//   - Human-in-the-loop at payment screen: agent MUST call the `done` tool
//     before submitting anything that charges the user. We never let it hit
//     the final confirm button autonomously in MVP.
//
// This runner does NOT yet support booking flows that require login. Day-1
// scope: searches and discovery (restaurants, flights, prices). Login
// credentials come in a later iteration behind encrypted integrations rows.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";
import {
  openConciergeBrowser,
  type ConciergeAction,
  type ConciergeBrowser,
} from "./concierge-browser";
import { mergeStorageStates } from "./concierge-pair";

type ConciergeArgs = {
  title?: string;
  notify?: boolean;
  max_steps?: number;
  // Optional per-task override for the spend autonomy limit. When unset the
  // runner falls back to profiles.concierge_auto_limit_gbp. Used by the errand
  // orchestrator to pin a subtask's autonomy to the parent errand's threshold.
  autonomy_limit_gbp?: number;
  // Optional pointer back to the errand that spawned this concierge run. Lets
  // the errand find the result without indexing on prompt content.
  parent_errand_id?: string;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4096;
const DEFAULT_MAX_STEPS = 25;

// Max wall-clock a paused task will wait for the user to approve before we
// give up, close the browser, and fail. Kept short-ish (5 min) because each
// paused task holds a live Chromium in memory; reopening is possible but
// requires us to persist storageState, so MVP keeps it in-process only.
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const APPROVAL_POLL_INTERVAL_MS = 8000;

const SYSTEM_PROMPT = [
  "You are the concierge agent in Vance, Reiss's multi-agent personal assistant.",
  "Your job: complete real-world tasks on the web using a headless browser —",
  "searches, price checks, restaurant lookups, flight research, and similar.",
  "",
  "Available tools:",
  "  • navigate(url)     — go to a URL",
  "  • read()            — get the current page's interactive elements (with IDs)",
  "                         and visible text. ALWAYS call this after navigate or",
  "                         click before deciding the next action.",
  "  • click_id(id)      — click an interactive element by the numeric ID from read()",
  "  • type_in(id, text, submit?) — fill an input by ID; submit=true presses Enter after",
  "  • press(key)        — press a keyboard key (e.g. 'Enter', 'Escape')",
  "  • scroll(direction) — scroll up or down one viewport",
  "  • wait(seconds)     — wait up to 10s for a slow page",
  "  • back()            — browser back",
  "  • confirm_booking(id, summary, amount_gbp) — call this INSTEAD of click_id",
  "                         when about to press the final 'Confirm' / 'Pay' /",
  "                         'Place order' button that charges the user. Pass the",
  "                         id of that button, a short summary of what is being",
  "                         bought, and the total amount in GBP. If the amount is",
  "                         within Reiss's autonomous limit the button is clicked",
  "                         immediately; otherwise the task pauses for Reiss to",
  "                         approve on WhatsApp.",
  "  • ping_user(message) — send a short WhatsApp update to Reiss RIGHT NOW. Use at",
  "                         material milestones the user would want to know about.",
  "                         One line, plain text, no markdown. Does not wait for a",
  "                         reply — the task continues.",
  "  • done(summary, data?) — finish the task. summary is plain text for the user;",
  "                           data is optional structured JSON (prices, links, etc.)",
  "",
  "How to work:",
  "- Plan briefly, then act. Each tool call costs money — be decisive.",
  "- After navigate(), ALWAYS call read() to see what's on the page. Element IDs",
  "  change between pages, so you must read() after every click_id or navigation.",
  "- Prefer going directly to the right URL (Google search, the site's search URL)",
  "  over clicking through home pages.",
  "- If you need a login (Uber, OpenTable, Booking etc.), the browser may already",
  "  be logged in via paired sessions. Just proceed. If you hit a login wall, call",
  "  done() with a note saying that site isn't paired yet.",
  "- For the FINAL paying/confirming action, use `confirm_booking` — never",
  "  `click_id` — so the spend-limit check runs. For all other clicks (picking a",
  "  restaurant, choosing a time, filling a form), use `click_id` as normal.",
  "- After a successful confirm_booking, call done() with the confirmation details.",
  "- If a page is blocked (captcha, CloudFlare), call done() with a note explaining",
  "  the block — don't spin.",
  "",
  "WHEN TO PING THE USER (ping_user):",
  "Send ONE SHORT WhatsApp line at each material milestone the user would care about:",
  "- Early signal: price / option identified before confirming (e.g. 'Uber £18, 12 min,",
  "  Toyota Prius — confirming now'). Good for catching a bad price early.",
  "- Booking placed: 'Booked. Ahmed, black Prius KP21 XYZ, 4 min away.'",
  "- Status change during a live ride/delivery: 'Driver arrived.' / 'Order out for",
  "  delivery, 12 min.' / 'Driver is at the pickup.'",
  "- Blocker hit that the user should know: 'Stuck on a 2FA prompt.'",
  "Do NOT ping for routine navigation ('clicked search', 'opened pickup picker') — those",
  "just go in the task log. One ping every few material steps is the right cadence.",
  "",
  "WATCHING A LIVE BOOKING (rides, deliveries):",
  "After confirm_booking succeeds for an Uber-style ride or a food delivery, the order",
  "has ongoing state the user cares about (driver en route / arrived / delivered). Do",
  "NOT immediately call done(). Instead, stay on the active-ride / active-order page,",
  "alternate wait(30) + read() in a loop, and ping_user when status changes materially",
  "(driver assigned, minutes-away drops a lot, arrived, delivered). Call done() only",
  "once the ride/order has ended OR you've been watching for 30+ minutes with no new",
  "news (in which case tell the user 'I'll stop watching now, check the app for updates').",
  "",
  "For pure info/search tasks with no live state (flight prices, opening hours, stock",
  "checks), call done() as soon as you have the answer — no watching loop needed.",
  "",
  "When you have the answer or the booking has fully resolved, call the `done` tool",
  "with a tight summary. Keep it under 200 words.",
].join("\n");

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: "navigate",
    description: "Navigate to a URL. Use https. Call read() after to see what's there.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Full https URL" } },
      required: ["url"],
    },
  },
  {
    name: "read",
    description:
      "Read the current page: returns a numbered list of interactive elements (links, buttons, inputs) with stable IDs, plus visible text. Call this after every navigate or click_id.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "click_id",
    description: "Click an element by its numeric ID from the most recent read().",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
  },
  {
    name: "type_in",
    description:
      "Fill an input by its numeric ID. Set submit=true to press Enter after (useful for search boxes).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        text: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["id", "text"],
    },
  },
  {
    name: "press",
    description: "Press a keyboard key (Enter, Escape, Tab, etc.)",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "scroll",
    description: "Scroll up or down one viewport (about 600px).",
    input_schema: {
      type: "object",
      properties: { direction: { type: "string", enum: ["up", "down"] } },
      required: ["direction"],
    },
  },
  {
    name: "wait",
    description: "Wait N seconds (max 10) for a slow page to settle.",
    input_schema: {
      type: "object",
      properties: { seconds: { type: "number" } },
      required: ["seconds"],
    },
  },
  {
    name: "back",
    description: "Browser back button.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "confirm_booking",
    description:
      "Click the FINAL confirm/pay/book button. Under Reiss's autonomous spend limit: clicks immediately. Over limit: pauses the task, pings Reiss on WhatsApp, resumes when he approves. Use this instead of click_id ONLY for the action that actually charges the card.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "The ID of the final confirm/pay button from the most recent read().",
        },
        summary: {
          type: "string",
          description:
            "Short human-readable description of what is being bought (e.g. 'Uber to Shoreditch, 14 min, £12.50').",
        },
        amount_gbp: {
          type: "number",
          description:
            "Total charge in GBP. Required. If unknown or free, pass 0 — but try to read it from the page.",
        },
      },
      required: ["id", "summary", "amount_gbp"],
    },
  },
  {
    name: "ping_user",
    description:
      "Send a short WhatsApp message to the user RIGHT NOW with a progress update. Use for material milestones the user wants to know about: 'opened Uber, finding pickup', 'price is £18 from here to Shoreditch, confirming', 'booked — driver Ahmed 4 min away, black Prius AB12 CDE', 'driver arrived', 'order placed, ETA 35 min'. Do NOT ping for every tiny step — only when a human would want to know. Does not wait for a reply; the task continues after.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The WhatsApp message body. Keep it to one line, under 200 chars. No markdown.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "done",
    description:
      "Finish the task. Provide a plain-text summary for the user and optional structured data (prices, links, options found).",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Plain-text summary for the user. <200 words." },
        data: {
          type: "object",
          description: "Optional structured result: prices, links, options, etc.",
          additionalProperties: true,
        },
      },
      required: ["summary"],
    },
  },
];

export async function runConciergeTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[concierge-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[concierge-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: ConciergeArgs = task.args ?? {};
  const notify = args.notify ?? true;
  const maxSteps = Math.min(args.max_steps ?? DEFAULT_MAX_STEPS, 40);
  const startedAt = new Date();

  await admin
    .from("tasks")
    .update({ status: "running", started_at: startedAt.toISOString() })
    .eq("id", taskId);

  const emit = async (
    kind: "text" | "tool_use" | "tool_result" | "progress" | "error",
    content: string | null,
    data: Record<string, unknown> | null = null,
  ) => {
    await admin.from("task_events").insert({
      task_id: taskId,
      user_id: task.user_id,
      kind,
      content,
      data,
    });
  };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  // Load the user's paired sessions + autonomous spend limit in parallel.
  const [sessionsRes, profileRes] = await Promise.all([
    admin
      .from("integrations")
      .select("provider, credentials")
      .eq("user_id", task.user_id)
      .eq("kind", "concierge_session")
      .eq("active", true),
    admin
      .from("profiles")
      .select("concierge_auto_limit_gbp")
      .eq("id", task.user_id)
      .single(),
  ]);

  const autoLimitGbp = Number(
    args.autonomy_limit_gbp ?? profileRes.data?.concierge_auto_limit_gbp ?? 0,
  );

  const storageStates = (sessionsRes.data ?? [])
    .map((row) => {
      const c = (row.credentials ?? {}) as { storage_state?: { cookies?: unknown[]; origins?: unknown[] } };
      return c.storage_state;
    })
    .filter((s): s is { cookies?: unknown[]; origins?: unknown[] } => !!s);

  const mergedState =
    storageStates.length > 0 ? mergeStorageStates(storageStates) : undefined;

  if (storageStates.length > 0) {
    await emit(
      "progress",
      `loaded ${storageStates.length} paired session(s); auto-limit £${autoLimitGbp}`,
    );
  }

  const cBrowser = await openConciergeBrowser({
    storageState: mergedState as Parameters<typeof openConciergeBrowser>[0]["storageState"],
  });

  let result = "";
  let resultData: Record<string, unknown> | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task.prompt },
  ];

  try {
    let step = 0;
    let model = MODEL;
    let modelSwitched = false;
    let finished = false;

    while (step < maxSteps && !finished) {
      step++;
      let response: Anthropic.Messages.Message;
      try {
        response = await anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });
      } catch (e) {
        if (!modelSwitched && isOverloadedError(e)) {
          modelSwitched = true;
          model = FALLBACK_MODEL;
          await emit("progress", `model overloaded, switching to ${FALLBACK_MODEL}`);
          continue;
        }
        throw e;
      }

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;

      let assistantText = "";
      for (const block of response.content) {
        if (block.type === "text") {
          assistantText += block.text;
          if (block.text.trim()) await emit("text", block.text);
        } else if (block.type === "tool_use") {
          await emit("tool_use", null, {
            name: block.name,
            input: block.input,
            id: block.id,
          });
        }
      }

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
        // Agent stopped without calling done — treat assistant text as summary.
        result = assistantText.trim() || "(concierge finished without summary)";
        break;
      }

      if (response.stop_reason === "max_tokens") {
        result = assistantText.trim() + "\n\n[Truncated — hit max tokens]";
        break;
      }

      if (response.stop_reason === "tool_use") {
        const toolUses = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
        );
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

        for (const tu of toolUses) {
          if (tu.name === "done") {
            const input = tu.input as { summary?: string; data?: Record<string, unknown> };
            result = input.summary ?? "(concierge finished)";
            resultData = input.data ?? null;
            finished = true;
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: "ok",
            });
            continue;
          }
          if (tu.name === "ping_user") {
            const input = tu.input as { message?: string };
            const message = String(input.message ?? "").trim();
            if (!message) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: "ping skipped: empty message",
                is_error: true,
              });
              continue;
            }
            const pingRes = await sendProgressPing(admin, task.user_id, taskId, message);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: pingRes.ok ? "ping sent" : `ping failed: ${pingRes.error}`,
              is_error: !pingRes.ok,
            });
            await emit("progress", `ping_user: ${message.slice(0, 200)}`);
            continue;
          }
          if (tu.name === "confirm_booking") {
            const input = tu.input as { id?: number; summary?: string; amount_gbp?: number };
            const btnId = Number(input.id);
            const summary = String(input.summary ?? "(no summary)");
            const amount = Number(input.amount_gbp ?? 0);
            const res = await handleConfirmBooking({
              admin,
              taskId,
              userId: task.user_id,
              cBrowser,
              btnId,
              summary,
              amount,
              autoLimit: autoLimitGbp,
              emit,
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: res.output,
              is_error: !res.ok,
            });
            await emit("tool_result", res.output.slice(0, 2000), { tool_use_id: tu.id });
            continue;
          }
          const { output, isError } = await runBrowserTool(cBrowser, tu);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: output,
            is_error: isError,
          });
          await emit("tool_result", output.slice(0, 2000), { tool_use_id: tu.id });
        }

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      break;
    }

    if (!finished && !result) {
      result = "(concierge hit step budget without finishing)";
    }

    const costUsd = estimateCost(inputTokens, outputTokens, cacheReadTokens);

    await admin
      .from("tasks")
      .update({
        status: "done",
        result,
        args: { ...args, result_data: resultData },
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cost_usd: costUsd,
      })
      .eq("id", taskId);

    if (notify) await queueCompletionNotification(admin, task.user_id, taskId, args.title);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit("error", msg);
    await admin
      .from("tasks")
      .update({
        status: "failed",
        error: msg,
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
      })
      .eq("id", taskId);
  } finally {
    await cBrowser.close();
  }
}

async function runBrowserTool(
  cBrowser: { execute: (a: ConciergeAction) => Promise<{ ok: boolean; output?: string; url?: string }> },
  tu: Anthropic.Messages.ToolUseBlock,
): Promise<{ output: string; isError: boolean }> {
  const input = tu.input as Record<string, unknown>;
  let action: ConciergeAction | null = null;
  switch (tu.name) {
    case "navigate":
      action = { type: "navigate", url: String(input.url ?? "") };
      break;
    case "read":
      action = { type: "read" };
      break;
    case "click_id":
      action = { type: "click_id", id: Number(input.id) };
      break;
    case "type_in":
      action = {
        type: "type_in",
        id: Number(input.id),
        text: String(input.text ?? ""),
        submit: Boolean(input.submit),
      };
      break;
    case "press":
      action = { type: "press", key: String(input.key ?? "Enter") };
      break;
    case "scroll":
      action = { type: "scroll", direction: (input.direction as "up" | "down") ?? "down" };
      break;
    case "wait":
      action = { type: "wait", seconds: Number(input.seconds ?? 2) };
      break;
    case "back":
      action = { type: "back" };
      break;
    default:
      return { output: `unknown tool: ${tu.name}`, isError: true };
  }
  const res = await cBrowser.execute(action);
  const body = res.output ?? (res.ok ? `ok (${res.url ?? ""})` : "failed");
  return { output: body.slice(0, 8000), isError: !res.ok };
}

function isOverloadedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}

// Haiku 4.5 pricing, USD per million tokens.
function estimateCost(input: number, output: number, cacheRead: number): number {
  const inputNonCached = Math.max(0, input - cacheRead);
  const cost =
    (inputNonCached / 1_000_000) * 1.0 +
    (cacheRead / 1_000_000) * 0.1 +
    (output / 1_000_000) * 5.0;
  return Math.round(cost * 10000) / 10000;
}

// Handles the confirm_booking tool. Under-limit = click immediately; over-limit
// = pause the task, ping Reiss on WhatsApp, poll the DB for him to approve
// (status flip from 'needs_approval' back to 'running'), then click.
async function handleConfirmBooking(opts: {
  admin: SupabaseClient;
  taskId: string;
  userId: string;
  cBrowser: ConciergeBrowser;
  btnId: number;
  summary: string;
  amount: number;
  autoLimit: number;
  emit: (
    kind: "text" | "tool_use" | "tool_result" | "progress" | "error",
    content: string | null,
    data?: Record<string, unknown> | null,
  ) => Promise<void>;
}): Promise<{ ok: boolean; output: string }> {
  const { admin, taskId, userId, cBrowser, btnId, summary, amount, autoLimit, emit } = opts;

  const underLimit = amount > 0 && amount <= autoLimit;

  if (underLimit) {
    await emit("progress", `auto-approving £${amount.toFixed(2)} (limit £${autoLimit.toFixed(2)}): ${summary}`);
    const res = await cBrowser.clickByJarvisId(btnId);
    if (!res.ok) return { ok: false, output: `confirm click failed: ${res.output ?? "unknown"}` };
    return {
      ok: true,
      output: `autonomously confirmed (£${amount.toFixed(2)} within limit). page now: ${res.url ?? ""}. Call done() next with the confirmation.`,
    };
  }

  // Over limit (or amount=0/unknown) — pause for human approval.
  await emit(
    "progress",
    amount > 0
      ? `£${amount.toFixed(2)} exceeds auto-limit £${autoLimit.toFixed(2)} — pausing for approval`
      : `amount unknown — pausing for manual approval`,
  );

  await admin
    .from("tasks")
    .update({
      status: "needs_approval",
      error: null,
      needs_approval_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  await notifyApprovalNeeded(admin, userId, taskId, summary, amount);

  const startedWaiting = Date.now();
  while (Date.now() - startedWaiting < APPROVAL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, APPROVAL_POLL_INTERVAL_MS));
    const { data: row } = await admin
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    if (!row) continue;
    if (row.status === "running") {
      // approved — do the click
      const res = await cBrowser.clickByJarvisId(btnId);
      if (!res.ok) return { ok: false, output: `approval received but click failed: ${res.output ?? "unknown"}` };
      await emit("progress", `approved by user, clicked confirm. now: ${res.url ?? ""}`);
      return {
        ok: true,
        output: `user approved. clicked confirm. page now: ${res.url ?? ""}. Call done() next with the confirmation.`,
      };
    }
    if (row.status === "failed" || row.status === "done" || row.status === "cancelled") {
      return { ok: false, output: `user declined approval (task status=${row.status}).` };
    }
    // still needs_approval → keep waiting
  }

  // Timed out. Leave status at needs_approval so the user can still approve
  // later manually via a fresh task; we just bail from this loop.
  return {
    ok: false,
    output: `timed out waiting ${Math.round(APPROVAL_TIMEOUT_MS / 60000)} min for approval. Call done() with the pending-booking summary.`,
  };
}

async function notifyApprovalNeeded(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  summary: string,
  amount: number,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return;

  const amountStr = amount > 0 ? `£${amount.toFixed(2)}` : "(amount unknown)";
  const body = `⚠️ Concierge needs approval: ${summary} ${amountStr}. Reply "approve" or open JARVIS → Tasks.`;

  const { data: notif } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
      task_id: taskId,
    })
    .select("id")
    .single();
  if (!notif) return;
  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[concierge-run] approval dispatch failed:", e);
  }
}

async function sendProgressPing(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return { ok: false, error: "no mobile on profile" };

  const body = message.length > 400 ? message.slice(0, 397) + "..." : message;

  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
      task_id: taskId,
    })
    .select("id")
    .single();
  if (error || !notif) return { ok: false, error: error?.message ?? "insert failed" };
  try {
    await dispatchNotification(admin, notif.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function queueCompletionNotification(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  title: string | undefined,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return;

  const label = title ? `"${title}"` : "your concierge task";
  const body = `🛎️ Concierge done: ${label}. Open JARVIS → Tasks.`;

  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
      task_id: taskId,
    })
    .select("id")
    .single();

  if (error || !notif) return;
  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[concierge-run] dispatch failed:", e);
  }
}
