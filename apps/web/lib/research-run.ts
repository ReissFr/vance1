// Server-side runner for the researcher agent. Loads a queued research task,
// runs an Anthropic loop with the built-in web_search tool, streams progress
// into task_events, writes the final brief to tasks.result, and queues a
// WhatsApp notification if the task was created with notify=true.
//
// Separate from the local code_agent worker: this has no Tauri dependency and
// runs entirely inside the Next.js process. Works from WhatsApp even when the
// laptop is off.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";

type ResearchArgs = {
  title?: string;
  notify?: boolean;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 8192;
const MAX_STEPS = 20;
const MAX_WEB_SEARCHES = 10;

export async function runResearchTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[research-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[research-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: ResearchArgs = task.args ?? {};
  const notify = args.notify ?? true;
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

  const systemPrompt = [
    "You are the researcher agent in Vance, Reiss's multi-agent personal assistant.",
    "Your job: investigate the user's question using web search, cross-check facts across",
    "multiple sources, and produce a well-structured written brief.",
    "",
    "How to work:",
    "- Plan briefly, then search. Use web_search aggressively — at least 2-3 queries,",
    "  more if the topic is broad or conflicting.",
    "- Quote numbers, dates, and specific claims with source URLs.",
    "- Flag uncertainty. If two sources disagree, say so rather than picking one silently.",
    "- When you have enough material, stop searching and write the final brief.",
    "",
    "Final brief format:",
    "- Start with a 2-3 sentence TL;DR answering the question directly.",
    "- Then 3-6 short sections with the supporting detail and cited sources.",
    "- End with any open questions or caveats.",
    "- Keep it tight — target 400-800 words. Reiss is time-poor.",
    "",
    "You have no shell, no file system, no device control — just web_search. Do not",
    "pretend to have other tools.",
  ].join("\n");

  let result = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task.prompt },
  ];

  // Anthropic's server-side web_search tool. The API handles browsing + result
  // ingestion; we just see tool_use blocks (with the query) and server_tool_use
  // result blocks inline.
  const tools: Anthropic.Messages.ToolUnion[] = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: MAX_WEB_SEARCHES,
    },
  ];

  try {
    let step = 0;
    let model = MODEL;
    let modelSwitched = false;
    while (step < MAX_STEPS) {
      step++;
      let response: Anthropic.Messages.Message;
      try {
        response = await anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          tools,
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

      // Record content blocks into task_events and accumulate assistant text.
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
        } else if (block.type === "server_tool_use") {
          await emit("tool_use", null, {
            name: block.name,
            input: block.input,
            id: block.id,
          });
        } else if (block.type === "web_search_tool_result") {
          const items = Array.isArray(block.content) ? block.content : [];
          const summary = items
            .map((it) => {
              if (it.type === "web_search_result") {
                return `• ${it.title} — ${it.url}`;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
          await emit("tool_result", summary || "(no results)", {
            tool_use_id: block.tool_use_id,
          });
        }
      }

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
        result = assistantText.trim();
        break;
      }

      if (response.stop_reason === "max_tokens") {
        result = assistantText.trim() + "\n\n[Brief truncated — hit max tokens]";
        break;
      }

      if (response.stop_reason === "tool_use") {
        // Server-side tools (web_search) don't need a client-side tool_result
        // turn — the API already inlined results. We only need to hand back
        // client tool results, and we don't expose any. So if we get here with
        // no client tool_use blocks, loop again by just continuing.
        const clientToolUses = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
        );
        if (clientToolUses.length === 0) {
          // Nothing to hand back — this shouldn't normally happen, but bail out
          // rather than infinite-loop.
          result = assistantText.trim();
          break;
        }
        // No client tools on this agent — treat as error.
        const unknown = clientToolUses.map((t) => t.name).join(", ");
        throw new Error(`researcher tried to use unknown client tool: ${unknown}`);
      }

      break;
    }

    const costUsd = estimateCost(inputTokens, outputTokens, cacheReadTokens);

    await admin
      .from("tasks")
      .update({
        status: "done",
        result: result || "(researcher finished without producing output)",
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
  }
}

function isOverloadedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}

// Rough pricing (USD per million tokens) — Haiku 4.5.
function estimateCost(input: number, output: number, cacheRead: number): number {
  const inputNonCached = Math.max(0, input - cacheRead);
  const cost =
    (inputNonCached / 1_000_000) * 1.0 +
    (cacheRead / 1_000_000) * 0.1 +
    (output / 1_000_000) * 5.0;
  return Math.round(cost * 10000) / 10000;
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
  if (!profile?.mobile_e164) {
    console.log("[research-run] no mobile for user — skipping notify:", userId);
    return;
  }

  const label = title ? `"${title}"` : "your research task";
  const body = `📚 Research done: ${label}. Open JARVIS → Tasks to read the brief.`;

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

  if (error || !notif) {
    console.warn("[research-run] failed to queue notification:", error?.message);
    return;
  }

  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[research-run] dispatch failed:", e);
  }
}
