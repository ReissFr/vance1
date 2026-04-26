// Errand agent — autonomous multi-day goal executor.
//
// Lifecycle:
//   user says "get me a cheaper car insurance" → brain calls start_errand tool
//     → tasks row inserted (kind='errand', status='queued', scheduled_at=now)
//   cron run-scheduled fires /api/tasks/run-errand every tick
//     → this file runs one LLM turn, executes the chosen action, updates state,
//       schedules next tick (or pauses for user approval, or finishes)
//
// Hybrid autonomy:
//   - Ambient: actions with spend < threshold_gbp (default £100), no recurring
//     commitment, no card details → just do it
//   - Checkpoint: spend >= threshold OR any recurring subscription OR card/bank
//     details required OR irreversible action → WhatsApp the user first
//
// The orchestrator LLM chooses one action per tick from a small, structured
// set. It's intentionally narrow in v0 — research + WhatsApp checkpoints +
// finish/giveup. Phone calls, emails, browser-driven purchases land in v1.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2000;
const MAX_HISTORY_ENTRIES = 30;
const MAX_WEB_SEARCHES_PER_TICK = 3;

const DEFAULT_THRESHOLD_GBP = 100;
const TICK_INTERVAL_MS = 30 * 60 * 1000;
// While a concierge subtask is running we want to react quickly when it
// finishes (or pauses for approval), so we poll on a much shorter interval.
const SUBTASK_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DEADLINE_DAYS = 7;

// Max ticks before we assume the loop is stuck and abandon. Prevents a stuck
// errand from burning tokens forever.
const MAX_TICKS = 60;

// --- Persistent state stored on tasks.result as JSON string ----------------

type ErrandStatus = "in_progress" | "awaiting_user" | "done" | "failed";

type HistoryEntry = {
  at: string;
  tick: number;
  action: string; // "research" | "checkpoint" | "purchase_proposed" | "finish" | "giveup" | "resume"
  summary: string;
  cost_gbp?: number;
  details?: Record<string, unknown>;
};

type PendingCheckpoint = {
  id: string;
  question: string;
  options: string[] | null; // null = free-form reply
  asked_at: string;
  reason: string; // why we're asking ("£389 exceeds £100 autonomy threshold")
};

// A concierge subtask the errand has spawned. While set, the errand polls the
// subtask each tick instead of calling the LLM. Cleared once the subtask
// finishes (success or fail) and its outcome is absorbed into history.
type PendingSubtask = {
  id: string;
  kind: "concierge";
  started_at: string;
  intent: {
    what: string;
    url: string;
    amount_gbp: number;
    recurring: boolean;
  };
};

type ErrandState = {
  version: 1;
  goal: string;
  budget_gbp: number | null;
  threshold_gbp: number;
  status: ErrandStatus;
  started_at: string;
  deadline: string;
  tick_count: number;
  history: HistoryEntry[];
  pending_checkpoint: PendingCheckpoint | null;
  pending_subtask: PendingSubtask | null;
  last_summary: string; // what to tell the user on WhatsApp after each ambient action
};

// --- Entrypoint ------------------------------------------------------------

export async function runErrandTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[errand-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[errand-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  await admin
    .from("tasks")
    .update({
      status: "running",
      started_at: task.started_at ?? new Date().toISOString(),
    })
    .eq("id", taskId);

  const state = loadOrInitState(task);
  const emit = makeEmit(admin, taskId, task.user_id);

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  const onUsage = (u: Anthropic.Messages.Usage) => {
    inputTokens += u.input_tokens;
    outputTokens += u.output_tokens;
    cacheReadTokens += u.cache_read_input_tokens ?? 0;
  };

  try {
    if (state.tick_count >= MAX_TICKS) {
      await finishErrand(admin, taskId, state, "failed", "Exceeded max ticks without resolution.", emit);
      return;
    }
    if (new Date(state.deadline).getTime() < Date.now()) {
      await finishErrand(admin, taskId, state, "failed", "Deadline reached without resolution.", emit);
      return;
    }

    state.tick_count += 1;

    // If a concierge subtask is in flight, poll it instead of calling the LLM.
    // The errand only resumes its own decision loop once the subtask resolves.
    if (state.pending_subtask) {
      const subtaskUpdate = await pollSubtask(admin, state);
      if (!subtaskUpdate.resolved) {
        await emit(
          "progress",
          `subtask ${state.pending_subtask.id} still ${subtaskUpdate.status}, polling again`,
        );
        const nextTickAt = new Date(Date.now() + SUBTASK_POLL_INTERVAL_MS).toISOString();
        await admin
          .from("tasks")
          .update({
            status: "queued",
            scheduled_at: nextTickAt,
            result: JSON.stringify(state),
            input_tokens: (task.input_tokens ?? 0) + inputTokens,
            output_tokens: (task.output_tokens ?? 0) + outputTokens,
            cache_read_tokens: (task.cache_read_tokens ?? 0) + cacheReadTokens,
          })
          .eq("id", taskId);
        return;
      }
      await emit("progress", `subtask resolved: ${subtaskUpdate.status}`);
      // Subtask done — fall through to the normal LLM tick. The history now
      // contains the subtask outcome, so the model can decide what to do next
      // (finish, propose another purchase, give up, etc.).
    }

    const decision = await decideNextAction({
      state,
      anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
      onUsage,
      onProgress: (m) => void emit("progress", m),
    });

    await applyDecision({
      admin,
      task,
      state,
      decision,
      emit,
    });

    const costUsd = estimateCost(inputTokens, outputTokens, cacheReadTokens);

    if (state.status === "done" || state.status === "failed") {
      await admin
        .from("tasks")
        .update({
          status: state.status,
          result: JSON.stringify(state),
          completed_at: new Date().toISOString(),
          input_tokens: (task.input_tokens ?? 0) + inputTokens,
          output_tokens: (task.output_tokens ?? 0) + outputTokens,
          cache_read_tokens: (task.cache_read_tokens ?? 0) + cacheReadTokens,
          cost_usd: (Number(task.cost_usd ?? 0) + costUsd).toFixed(4),
        })
        .eq("id", taskId);
      return;
    }

    if (state.status === "awaiting_user") {
      // Pause: cron won't pick this up again until the user replies and the
      // brain calls errand_respond, which re-queues with scheduled_at=now.
      await admin
        .from("tasks")
        .update({
          status: "needs_approval",
          needs_approval_at: new Date().toISOString(),
          result: JSON.stringify(state),
          input_tokens: (task.input_tokens ?? 0) + inputTokens,
          output_tokens: (task.output_tokens ?? 0) + outputTokens,
          cache_read_tokens: (task.cache_read_tokens ?? 0) + cacheReadTokens,
          cost_usd: (Number(task.cost_usd ?? 0) + costUsd).toFixed(4),
        })
        .eq("id", taskId);
      return;
    }

    // Still in progress — schedule next tick. If we just spawned a concierge
    // subtask, poll on the shorter interval so we react fast when it finishes.
    const intervalMs = state.pending_subtask ? SUBTASK_POLL_INTERVAL_MS : TICK_INTERVAL_MS;
    const nextTickAt = new Date(Date.now() + intervalMs).toISOString();
    await admin
      .from("tasks")
      .update({
        status: "queued",
        scheduled_at: nextTickAt,
        result: JSON.stringify(state),
        input_tokens: (task.input_tokens ?? 0) + inputTokens,
        output_tokens: (task.output_tokens ?? 0) + outputTokens,
        cache_read_tokens: (task.cache_read_tokens ?? 0) + cacheReadTokens,
        cost_usd: (Number(task.cost_usd ?? 0) + costUsd).toFixed(4),
      })
      .eq("id", taskId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit("error", msg);
    await admin
      .from("tasks")
      .update({
        status: "failed",
        error: msg,
        result: JSON.stringify(state),
        completed_at: new Date().toISOString(),
        input_tokens: (task.input_tokens ?? 0) + inputTokens,
        output_tokens: (task.output_tokens ?? 0) + outputTokens,
        cache_read_tokens: (task.cache_read_tokens ?? 0) + cacheReadTokens,
      })
      .eq("id", taskId);
  }
}

// --- Resume from user reply ------------------------------------------------

// Called by the brain's errand_respond tool. Appends the user's answer to
// state, clears the pending checkpoint, flips the task back to queued with
// scheduled_at=now so the cron picks it up on the next tick.
export async function resumeErrandWithReply(
  admin: SupabaseClient,
  taskId: string,
  userReply: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: task, error } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (error || !task) return { ok: false, error: error?.message ?? "not found" };
  if (task.kind !== "errand") return { ok: false, error: "not an errand task" };

  const state = loadOrInitState(task);
  if (!state.pending_checkpoint) {
    return { ok: false, error: "no pending checkpoint to resume" };
  }

  state.history.push({
    at: new Date().toISOString(),
    tick: state.tick_count,
    action: "resume",
    summary: `User replied: ${userReply}`,
    details: { checkpoint_id: state.pending_checkpoint.id },
  });
  state.pending_checkpoint = null;
  state.status = "in_progress";
  state.history = trimHistory(state.history);

  await admin
    .from("tasks")
    .update({
      status: "queued",
      scheduled_at: new Date().toISOString(),
      result: JSON.stringify(state),
    })
    .eq("id", taskId);

  return { ok: true };
}

// --- State init ------------------------------------------------------------

function loadOrInitState(task: {
  args: Record<string, unknown> | null;
  result: string | null;
}): ErrandState {
  if (task.result) {
    try {
      const parsed = JSON.parse(task.result) as ErrandState;
      if (parsed.version === 1) return parsed;
    } catch {
      // fall through to re-init
    }
  }
  const args = (task.args ?? {}) as {
    goal?: string;
    budget_gbp?: number;
    threshold_gbp?: number;
    deadline?: string;
  };
  const deadline =
    args.deadline ??
    new Date(Date.now() + DEFAULT_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return {
    version: 1,
    goal: args.goal ?? "(no goal specified)",
    budget_gbp: args.budget_gbp ?? null,
    threshold_gbp: args.threshold_gbp ?? DEFAULT_THRESHOLD_GBP,
    status: "in_progress",
    started_at: new Date().toISOString(),
    deadline,
    tick_count: 0,
    history: [],
    pending_checkpoint: null,
    pending_subtask: null,
    last_summary: "",
  };
}

function trimHistory(h: HistoryEntry[]): HistoryEntry[] {
  if (h.length <= MAX_HISTORY_ENTRIES) return h;
  // Keep the first 3 (context of the goal) and the last N-3.
  return [...h.slice(0, 3), ...h.slice(-(MAX_HISTORY_ENTRIES - 3))];
}

// --- LLM decision ----------------------------------------------------------

type Decision =
  | { action: "research"; summary: string; findings: string }
  | {
      action: "checkpoint";
      question: string;
      options: string[] | null;
      reason: string;
      summary: string;
    }
  | {
      action: "propose_purchase";
      amount_gbp: number;
      what: string;
      url: string | null;
      recurring: boolean;
      reason: string;
      summary: string;
      // Set true when the user has already approved this exact purchase via a
      // previous checkpoint reply. Skips the approval pause and goes straight
      // to ambient execution (concierge subtask if a url is provided).
      prior_approval?: boolean;
    }
  | { action: "finish"; summary: string; outcome: Record<string, unknown> | null }
  | { action: "giveup"; summary: string; reason: string };

async function decideNextAction(input: {
  state: ErrandState;
  anthropic: Anthropic;
  onUsage: (u: Anthropic.Messages.Usage) => void;
  onProgress: (msg: string) => void;
}): Promise<Decision> {
  const { state, anthropic, onUsage, onProgress } = input;
  const system = buildSystemPrompt(state);
  const userMsg = buildStateDump(state);

  const tools: Anthropic.Messages.ToolUnion[] = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: MAX_WEB_SEARCHES_PER_TICK,
    },
    {
      name: "decide",
      description:
        "Commit to exactly one next action for the errand. Must be called exactly once per tick. After any research via web_search, use this to record what you learned (action='research') or to move the errand forward (checkpoint/purchase/finish/giveup).",
      input_schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["research", "checkpoint", "propose_purchase", "finish", "giveup"],
          },
          summary: {
            type: "string",
            description: "One-line summary of this tick for the history log.",
          },
          // research
          findings: { type: "string" },
          // checkpoint
          question: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of short reply options (A/B/C style). Omit for free-form.",
          },
          reason: { type: "string" },
          // propose_purchase
          amount_gbp: { type: "number" },
          what: { type: "string" },
          url: {
            type: "string",
            description:
              "Direct checkout URL (deep link to the cart/booking page if possible). When provided, the system spawns a concierge browser to complete checkout autonomously — under the autonomy threshold it just buys; over threshold it pauses for the user.",
          },
          recurring: { type: "boolean" },
          prior_approval: {
            type: "boolean",
            description:
              "Set to true if the user has already approved this exact purchase via a previous checkpoint reply (e.g. 'yes'). Skips the approval pause and triggers concierge execution directly.",
          },
          // finish
          outcome: { type: "object", additionalProperties: true },
        },
        required: ["action", "summary"],
      },
    },
  ];

  let model = MODEL;
  let modelSwitched = false;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userMsg }];

  for (let step = 0; step < 5; step++) {
    onProgress(`tick ${state.tick_count}: calling ${model} (step ${step + 1})`);
    let res: Anthropic.Messages.Message;
    try {
      res = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
      });
    } catch (e) {
      if (!modelSwitched && isOverloadedError(e)) {
        modelSwitched = true;
        model = FALLBACK_MODEL;
        continue;
      }
      throw e;
    }
    onUsage(res.usage);

    messages.push({ role: "assistant", content: res.content });

    const decideCall = res.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock =>
        b.type === "tool_use" && b.name === "decide",
    );
    if (decideCall) return decideCall.input as Decision;

    if (res.stop_reason === "end_turn") {
      // Model ended without deciding — nudge it once.
      messages.push({
        role: "user",
        content:
          "You must call the `decide` tool exactly once before ending. Pick the best next action now.",
      });
      continue;
    }

    if (res.stop_reason === "tool_use") {
      // Only web_search is a non-decide tool, and the server-side web_search
      // tool's result is already streamed back via the content blocks — the
      // model will see it on the next iteration automatically. Continue.
      continue;
    }
  }

  throw new Error("orchestrator failed to produce a decision within step budget");
}

function buildSystemPrompt(state: ErrandState): string {
  return [
    "You are the errand agent in Vance, Reiss's personal assistant. You are driving a",
    "multi-day goal to completion. You run on a 30-minute tick — pick ONE next action",
    "per tick.",
    "",
    "GOAL:",
    state.goal,
    state.budget_gbp !== null ? `BUDGET: £${state.budget_gbp}` : "BUDGET: not specified",
    `AUTONOMY THRESHOLD: £${state.threshold_gbp} — you may spend up to this without asking.`,
    `DEADLINE: ${state.deadline}`,
    "",
    "ACTIONS (choose one per tick via the `decide` tool):",
    "- research: when you need info. Call web_search first (up to 3x), then call",
    "  decide(action='research', summary, findings). The findings + summary go into",
    "  the errand's history so next tick can build on it.",
    "- checkpoint: WhatsApp Reiss a question and pause until he replies. Use when",
    "  you need his preference, a decision you can't make, or explicit approval.",
    "- propose_purchase: you're ready to buy something. Give amount_gbp, what, url,",
    "  recurring. If amount_gbp >= threshold OR recurring=true, the system pauses",
    "  for Reiss to approve on WhatsApp — you don't need a separate checkpoint.",
    "  If under threshold and one-off, it goes through as ambient. When `url` is a",
    "  direct checkout link, the system spawns a concierge browser that completes",
    "  the purchase autonomously (within the autonomy limit). After spawning the",
    "  errand will pause this loop and poll the concierge — the next tick you see",
    "  will already include the subtask outcome in history.",
    "  Set `prior_approval=true` when the previous tick was a checkpoint and the",
    "  user said yes to this exact purchase. That bypasses the over-threshold",
    "  pause and goes straight to concierge execution.",
    "- finish: the goal is achieved. Summarise the outcome. Reiss will be pinged.",
    "- giveup: you're stuck, blocked, or the goal is impossible. Explain why.",
    "",
    "WHEN TO CHECKPOINT (always pause and ask):",
    "- Any spend >= threshold",
    "- Any recurring / subscription commitment, even if cheap",
    "- Giving out card, bank, or personal details on Reiss's behalf",
    "- Irreversible actions (signing contracts, cancelling important accounts)",
    "- You're below 60% confident in the plan",
    "",
    "WHEN TO BE AMBIENT (just act):",
    "- Reading, searching, comparing",
    "- Drafting (emails, messages) — drafting is free, sending isn't",
    "- One-off spends under threshold on clearly appropriate items",
    "",
    "STYLE:",
    "- British English. Punchy, warm, direct. No corporate filler.",
    "- Each tick's `summary` is ONE LINE that explains what you did, not what you're",
    "  about to do. It shows up in Reiss's task history.",
    "- Don't repeat work — check the history before researching.",
    "- Don't keep re-asking the same question. If Reiss has already answered, use it.",
  ].join("\n");
}

function buildStateDump(state: ErrandState): string {
  const lines: string[] = [];
  lines.push(`TICK: ${state.tick_count} / ${MAX_TICKS}`);
  lines.push(`STATUS: ${state.status}`);
  lines.push(`TIME: ${new Date().toISOString()}`);
  if (state.history.length > 0) {
    lines.push("");
    lines.push("HISTORY SO FAR:");
    state.history.forEach((h, i) => {
      const cost = h.cost_gbp !== undefined ? ` (£${h.cost_gbp})` : "";
      lines.push(`${i + 1}. [${h.action}] ${h.summary}${cost}`);
    });
  } else {
    lines.push("");
    lines.push("HISTORY: (empty — this is the first tick)");
  }
  lines.push("");
  lines.push("Decide your next action now via the `decide` tool.");
  return lines.join("\n");
}

// --- Apply decision --------------------------------------------------------

async function applyDecision(input: {
  admin: SupabaseClient;
  task: { id: string; user_id: string };
  state: ErrandState;
  decision: Decision;
  emit: Emit;
}): Promise<void> {
  const { admin, task, state, decision, emit } = input;
  const now = new Date().toISOString();

  switch (decision.action) {
    case "research": {
      state.history.push({
        at: now,
        tick: state.tick_count,
        action: "research",
        summary: decision.summary,
        details: { findings: decision.findings },
      });
      await emit("progress", `research: ${decision.summary}`);
      break;
    }

    case "checkpoint": {
      const checkpointId = `ck_${Date.now().toString(36)}`;
      state.pending_checkpoint = {
        id: checkpointId,
        question: decision.question,
        options: decision.options ?? null,
        asked_at: now,
        reason: decision.reason,
      };
      state.status = "awaiting_user";
      state.history.push({
        at: now,
        tick: state.tick_count,
        action: "checkpoint",
        summary: decision.summary,
        details: { question: decision.question, reason: decision.reason },
      });
      await sendCheckpointWhatsApp(admin, task.user_id, task.id, state);
      break;
    }

    case "propose_purchase": {
      const priorApproval = decision.prior_approval === true;
      const overThreshold =
        decision.amount_gbp >= state.threshold_gbp || decision.recurring === true;
      const needsApproval = overThreshold && !priorApproval;

      if (needsApproval) {
        const checkpointId = `ck_${Date.now().toString(36)}`;
        const q = decision.recurring
          ? `Recurring purchase: ${decision.what} — £${decision.amount_gbp}${
              decision.url ? `\n${decision.url}` : ""
            }\n\nApprove?`
          : `Purchase: ${decision.what} — £${decision.amount_gbp}${
              decision.url ? `\n${decision.url}` : ""
            }\n\nApprove?`;
        state.pending_checkpoint = {
          id: checkpointId,
          question: q,
          options: ["yes", "no"],
          asked_at: now,
          reason: decision.reason,
        };
        state.status = "awaiting_user";
        state.history.push({
          at: now,
          tick: state.tick_count,
          action: "purchase_proposed",
          summary: decision.summary,
          cost_gbp: decision.amount_gbp,
          details: {
            what: decision.what,
            url: decision.url,
            recurring: decision.recurring,
            needs_approval: true,
            reason: decision.reason,
          },
        });
        await sendCheckpointWhatsApp(admin, task.user_id, task.id, state);
        break;
      }

      // Approved (or ambient) — try to execute via concierge browser if we have
      // a URL. Without one we fall back to telling the user (v0 behaviour).
      if (decision.url) {
        await spawnConciergeSubtask({ admin, task, state, decision });
        await emit(
          "progress",
          `spawned concierge subtask ${state.pending_subtask?.id ?? ""} for £${decision.amount_gbp}`,
        );
      } else {
        state.history.push({
          at: now,
          tick: state.tick_count,
          action: "purchase_proposed",
          summary: decision.summary,
          cost_gbp: decision.amount_gbp,
          details: {
            what: decision.what,
            url: decision.url,
            recurring: decision.recurring,
            needs_approval: false,
            reason: decision.reason,
          },
        });
        const body = [
          `✅ Purchase within autonomy limit — but no checkout URL to drive, so heads up:`,
          `${decision.what} — £${decision.amount_gbp}`,
        ].join("\n");
        await sendWhatsApp(admin, task.user_id, task.id, body);
      }
      break;
    }

    case "finish": {
      state.history.push({
        at: now,
        tick: state.tick_count,
        action: "finish",
        summary: decision.summary,
        details: decision.outcome ?? undefined,
      });
      state.status = "done";
      state.last_summary = decision.summary;
      await sendWhatsApp(
        admin,
        task.user_id,
        task.id,
        `✅ Errand done.\n\n${decision.summary}`,
      );
      break;
    }

    case "giveup": {
      state.history.push({
        at: now,
        tick: state.tick_count,
        action: "giveup",
        summary: decision.summary,
        details: { reason: decision.reason },
      });
      state.status = "failed";
      state.last_summary = decision.summary;
      await sendWhatsApp(
        admin,
        task.user_id,
        task.id,
        `⚠️ Errand stopped.\n\n${decision.summary}\n\nWhy: ${decision.reason}`,
      );
      break;
    }
  }

  state.history = trimHistory(state.history);
}

async function finishErrand(
  admin: SupabaseClient,
  taskId: string,
  state: ErrandState,
  finalStatus: "done" | "failed",
  reason: string,
  _emit: Emit,
): Promise<void> {
  state.status = finalStatus;
  state.history.push({
    at: new Date().toISOString(),
    tick: state.tick_count,
    action: finalStatus === "done" ? "finish" : "giveup",
    summary: reason,
  });
  await admin
    .from("tasks")
    .update({
      status: finalStatus,
      result: JSON.stringify(state),
      completed_at: new Date().toISOString(),
      error: finalStatus === "failed" ? reason : null,
    })
    .eq("id", taskId);
}

// --- WhatsApp helpers ------------------------------------------------------

async function sendCheckpointWhatsApp(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  state: ErrandState,
): Promise<void> {
  const cp = state.pending_checkpoint;
  if (!cp) return;
  const optionsLine = cp.options
    ? `\n\nReply: ${cp.options.join(" / ")}`
    : "\n\n(Reply in WhatsApp — anything you write here will feed back into the errand.)";
  const body = `🔔 Errand: ${truncate(state.goal, 60)}\n\n${cp.question}${optionsLine}`;
  await sendWhatsApp(admin, userId, taskId, body);
}

async function sendWhatsApp(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  body: string,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return;
  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      task_id: taskId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !notif) {
    console.warn("[errand-run] notification insert failed:", error?.message);
    return;
  }
  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[errand-run] dispatch failed:", e);
  }
}

// --- Concierge subtask chaining --------------------------------------------

// Spawn a concierge browser task that completes a checkout. Inserts a tasks
// row with kind='concierge' + autonomy_limit_gbp pinned to this errand's
// threshold, fires the runner, and stamps pending_subtask on the errand state.
async function spawnConciergeSubtask(opts: {
  admin: SupabaseClient;
  task: { id: string; user_id: string };
  state: ErrandState;
  decision: Extract<Decision, { action: "propose_purchase" }>;
}): Promise<void> {
  const { admin, task, state, decision } = opts;
  const url = decision.url!;
  const prompt = [
    `Errand: ${truncate(state.goal, 200)}`,
    "",
    `Complete this purchase on Reiss's behalf:`,
    `- What: ${decision.what}`,
    `- Approx total: £${decision.amount_gbp}`,
    `- URL: ${url}`,
    decision.recurring ? `- Note: recurring/subscription` : null,
    "",
    `Navigate to the URL, drive the checkout, and use confirm_booking (NOT click_id)`,
    `for the final pay/confirm button. Your autonomy limit is £${state.threshold_gbp}.`,
    `If the price on the page is materially different from £${decision.amount_gbp},`,
    `or you hit a login wall / captcha, call done() with what you found and stop.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data: subtask, error } = await admin
    .from("tasks")
    .insert({
      user_id: task.user_id,
      kind: "concierge",
      prompt,
      args: {
        title: `errand purchase: ${truncate(decision.what, 60)}`,
        notify: false, // the errand will message the user once it absorbs the result
        autonomy_limit_gbp: state.threshold_gbp,
        parent_errand_id: task.id,
      },
      device_target: "server",
      status: "queued",
      scheduled_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !subtask) {
    throw new Error(`Failed to spawn concierge subtask: ${error?.message ?? "no row"}`);
  }

  state.pending_subtask = {
    id: subtask.id,
    kind: "concierge",
    started_at: new Date().toISOString(),
    intent: {
      what: decision.what,
      url,
      amount_gbp: decision.amount_gbp,
      recurring: decision.recurring,
    },
  };

  state.history.push({
    at: new Date().toISOString(),
    tick: state.tick_count,
    action: "subtask_spawned",
    summary: `Concierge launched to buy: ${truncate(decision.what, 80)} (£${decision.amount_gbp})`,
    cost_gbp: decision.amount_gbp,
    details: {
      subtask_id: subtask.id,
      url,
      recurring: decision.recurring,
      reason: decision.reason,
    },
  });

  // Fire-and-forget the runner so the subtask starts immediately rather than
  // waiting for the cron to pick it up.
  void fetch(`${internalBaseUrl()}/api/tasks/run-concierge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_id: subtask.id }),
  }).catch((e) => {
    console.warn("[errand-run] concierge dispatch failed:", e);
  });
}

// Check whether the pending concierge subtask has resolved. If yes, append its
// outcome to history and clear pending_subtask. Returns whether the parent
// errand should continue this tick (resolved=true) or wait another poll.
async function pollSubtask(
  admin: SupabaseClient,
  state: ErrandState,
): Promise<{ resolved: boolean; status: string }> {
  const sub = state.pending_subtask!;
  const { data: row, error } = await admin
    .from("tasks")
    .select("status, result, error, args")
    .eq("id", sub.id)
    .single();

  if (error || !row) {
    // Subtask vanished — treat as failed so we don't loop forever.
    state.history.push({
      at: new Date().toISOString(),
      tick: state.tick_count,
      action: "subtask_lost",
      summary: `Concierge subtask ${sub.id} not found — abandoning purchase`,
      details: { subtask_id: sub.id, error: error?.message },
    });
    state.pending_subtask = null;
    return { resolved: true, status: "lost" };
  }

  const status = String(row.status);
  if (status === "queued" || status === "running" || status === "needs_approval") {
    return { resolved: false, status };
  }

  // done | failed | cancelled — absorb outcome.
  const summary =
    typeof row.result === "string" && row.result.length > 0
      ? row.result
      : status === "done"
        ? "(concierge finished)"
        : (row.error ?? "(concierge stopped)");
  const argsBag = (row.args ?? {}) as { result_data?: unknown };

  state.history.push({
    at: new Date().toISOString(),
    tick: state.tick_count,
    action: "subtask_complete",
    summary: `Concierge ${status}: ${truncate(summary, 240)}`,
    cost_gbp: status === "done" ? sub.intent.amount_gbp : undefined,
    details: {
      subtask_id: sub.id,
      subtask_status: status,
      intent: sub.intent,
      result_data: argsBag.result_data ?? null,
    },
  });
  state.pending_subtask = null;
  return { resolved: true, status };
}

function internalBaseUrl(): string {
  return (
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030"
  );
}

// --- Misc helpers ----------------------------------------------------------

type Emit = (
  kind: "text" | "progress" | "error",
  content: string | null,
  data?: Record<string, unknown> | null,
) => Promise<void>;

function makeEmit(admin: SupabaseClient, taskId: string, userId: string): Emit {
  return async (kind, content, data = null) => {
    await admin.from("task_events").insert({
      task_id: taskId,
      user_id: userId,
      kind,
      content,
      data,
    });
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function isOverloadedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}

function estimateCost(input: number, output: number, cacheRead: number): number {
  const inputNonCached = Math.max(0, input - cacheRead);
  const cost =
    (inputNonCached / 1_000_000) * 1.0 +
    (cacheRead / 1_000_000) * 0.1 +
    (output / 1_000_000) * 5.0;
  return Math.round(cost * 10000) / 10000;
}
