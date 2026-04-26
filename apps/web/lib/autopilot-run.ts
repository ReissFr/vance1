// Autopilot runner. One goal → JARVIS takes the machine and executes end-to-end
// across every tool it has. Runs server-side in a long tool loop, streaming
// each step into autopilot_runs.steps so the UI can watch live.
//
// Design:
//   - Sonnet-first (heavy reasoning over many rounds); Haiku as fallback on
//     overload only. Autopilot is not where we save pennies.
//   - Step budget 80 rounds. Hard stop. Bigger than concierge (25) because
//     autopilot can jump between 5+ domains (email, browser, calendar, etc).
//   - Cancellation: check autopilot_runs.status before each round. Flipping
//     to 'cancelled' in the UI aborts between rounds.
//   - Per-tool progress: each tool_use + tool_result appended to steps[],
//     keeping the DB row small by truncating long results.
//
// This runner deliberately does NOT use the shared runBrain generator. That
// caps at 12 rounds and doesn't expose a cancellation hook. The loop here is
// the same shape but autopilot-aware.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CORE_TOOLS,
  TOOLS_BY_NAME,
  asAnthropicTool,
  makeVoyageEmbed,
  systemPrompt,
  type ToolContext,
} from "@jarvis/agent";
import { dispatchNotification } from "./notify";
import { executeBrowserAction } from "./browser";

const PRIMARY_MODEL = "claude-sonnet-4-5-20250929";
const FALLBACK_MODEL = "claude-haiku-4-5-20251001";
const MAX_ROUNDS = 80;
const MAX_TOKENS = 4096;

const AUTOPILOT_SYSTEM_SUFFIX = [
  "",
  "<autopilot_mode>",
  "You are in AUTOPILOT MODE. The user has handed you a single goal and stepped",
  "away. You have a long step budget and must EXECUTE the entire goal without",
  "asking follow-up questions.",
  "",
  "Rules:",
  "- Plan briefly (1-2 sentences max), then ACT. Don't narrate.",
  "- Use tools aggressively. You have email, calendar, browser, banking, payments,",
  "  smart-home, concierge, research, writer, automations, and more.",
  "- Break the goal into sub-tasks and knock them off one by one. After each,",
  "  briefly state what you just finished, then continue.",
  "- Never ask the user a clarifying question mid-run. If something is ambiguous,",
  "  make a reasonable choice, note it, and keep going.",
  "- For irreversible actions (sending emails, spending money, booking things),",
  "  draft and leave for approval via the notify_user / draft_email / concierge",
  "  patterns — do not auto-send unless the user's goal explicitly said 'send'.",
  "- When the whole goal is done, produce a final summary block starting with",
  "  'DONE:' followed by a crisp bullet list of what you accomplished.",
  "</autopilot_mode>",
].join("\n");

export interface StartAutopilotInput {
  admin: SupabaseClient;
  userId: string;
  runId: string;
}

type StepEntry = Record<string, unknown>;

export async function runAutopilot(input: StartAutopilotInput): Promise<void> {
  const { admin, userId, runId } = input;

  const { data: run, error: loadErr } = await admin
    .from("autopilot_runs")
    .select("id, goal, status")
    .eq("id", runId)
    .single();
  if (loadErr || !run) {
    console.error("[autopilot] run not found:", runId, loadErr?.message);
    return;
  }
  if (run.status !== "queued") return;

  await admin
    .from("autopilot_runs")
    .update({ status: "planning", started_at: new Date().toISOString() })
    .eq("id", runId);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const embed = makeVoyageEmbed(process.env.VOYAGE_API_KEY ?? "");

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, google_access_token")
    .eq("id", userId)
    .single();

  const sysText =
    systemPrompt({
      ...(profile?.display_name ? { userName: profile.display_name as string } : {}),
      deviceKind: "web",
      recentMemories: [],
      currentDateISO: new Date().toISOString(),
    }) + AUTOPILOT_SYSTEM_SUFFIX;

  const tools = CORE_TOOLS.map(asAnthropicTool);

  const toolCtx: ToolContext = {
    userId,
    supabase: admin,
    embed,
    dispatchNotification: (id: string) => dispatchNotification(admin, id),
    executeBrowserAction,
    ...(profile?.google_access_token
      ? { googleAccessToken: profile.google_access_token as string }
      : {}),
  };

  const steps: StepEntry[] = [];
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: run.goal as string },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let finalText = "";
  let modelToUse = PRIMARY_MODEL;

  const pushStep = async (entry: StepEntry) => {
    steps.push({ at: new Date().toISOString(), ...entry });
    await admin.from("autopilot_runs").update({ steps }).eq("id", runId);
  };

  await admin.from("autopilot_runs").update({ status: "running" }).eq("id", runId);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Cancellation check between rounds.
    const { data: statusRow } = await admin
      .from("autopilot_runs")
      .select("status")
      .eq("id", runId)
      .single();
    if (statusRow?.status === "cancelled") {
      await pushStep({ type: "cancelled", round });
      await admin
        .from("autopilot_runs")
        .update({
          completed_at: new Date().toISOString(),
          input_tokens: totalInput,
          output_tokens: totalOutput,
        })
        .eq("id", runId);
      return;
    }

    let response: Anthropic.Messages.Message;
    try {
      response = await anthropic.messages.create({
        model: modelToUse,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: sysText, cache_control: { type: "ephemeral" } }],
        tools: tools as Anthropic.Messages.Tool[],
        messages,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Overload → fall back once and continue the same round.
      if (modelToUse === PRIMARY_MODEL && /overload|529|rate_limit/i.test(msg)) {
        modelToUse = FALLBACK_MODEL;
        await pushStep({ type: "model_fallback", reason: msg });
        round -= 1;
        continue;
      }
      await pushStep({ type: "error", error: msg });
      await admin
        .from("autopilot_runs")
        .update({
          status: "failed",
          error: msg,
          completed_at: new Date().toISOString(),
          input_tokens: totalInput,
          output_tokens: totalOutput,
        })
        .eq("id", runId);
      return;
    }

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    messages.push({ role: "assistant", content: response.content });

    const textBlocks = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");
    for (const tb of textBlocks) {
      if (tb.text.trim()) {
        finalText = tb.text;
        await pushStep({ type: "text", text: tb.text });
      }
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // No tool calls → model is done.
      await admin
        .from("autopilot_runs")
        .update({
          status: "done",
          result: finalText,
          completed_at: new Date().toISOString(),
          input_tokens: totalInput,
          output_tokens: totalOutput,
        })
        .eq("id", runId);
      return;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      await pushStep({ type: "tool_use", id: use.id, name: use.name, input: use.input });
      const def = TOOLS_BY_NAME[use.name];
      if (!def) {
        const msg = `Unknown tool: ${use.name}`;
        await pushStep({ type: "tool_result", id: use.id, error: msg });
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
        continue;
      }
      try {
        const result = await def.run(use.input, toolCtx);
        await pushStep({ type: "tool_result", id: use.id, name: use.name, result: summariseResult(result) });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await pushStep({ type: "tool_result", id: use.id, name: use.name, error: msg });
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  await pushStep({ type: "error", error: `Hit MAX_ROUNDS=${MAX_ROUNDS} without completing` });
  await admin
    .from("autopilot_runs")
    .update({
      status: "failed",
      error: `Exceeded ${MAX_ROUNDS} rounds`,
      completed_at: new Date().toISOString(),
      input_tokens: totalInput,
      output_tokens: totalOutput,
    })
    .eq("id", runId);
}

function summariseResult(r: unknown): unknown {
  if (typeof r === "string") return r.length > 400 ? r.slice(0, 400) + "…" : r;
  try {
    const s = JSON.stringify(r);
    if (s.length > 600) return JSON.parse(s.slice(0, 600) + "\"}");
    return r;
  } catch {
    return "[unserialisable result]";
  }
}
