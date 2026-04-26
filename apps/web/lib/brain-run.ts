// Non-streaming brain runner for contexts where there's no HTTP client
// streaming back (e.g. inbound WhatsApp webhooks, background workers).
// Resolves-or-creates a conversation, loads history, persists the user turn,
// runs the brain to completion, persists the assistant turn, and returns the
// final assembled text reply.

import Anthropic from "@anthropic-ai/sdk";
import { runBrain, makeVoyageEmbed, loadSkillIndex, loadSkillBody, installSkill, previewSkill, execSkillScript } from "@jarvis/agent";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";
import { executeBrowserAction } from "./browser";
import { join } from "node:path";

const SKILLS_DIR = join(process.cwd(), "skills");

const HISTORY_LIMIT = 30;
// A WhatsApp thread feels more PA-like if we continue the most recent
// conversation within this window instead of starting a fresh one each time.
const CONTINUE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RunBrainForMessageInput {
  admin: SupabaseClient;
  userId: string;
  message: string;
  // "mac" enables device tools via the pending_client_actions queue (executed
  // by the user's Tauri desktop app). "web" restricts to server-side tools.
  deviceKind?: "web" | "mac" | "desktop";
  // Where to send follow-up results when a queued action completes after the
  // brain has returned (pending timeout). Optional — if absent, the late
  // result is simply logged.
  followupChannel?: "whatsapp" | "sms";
  followupToE164?: string;
}

export interface RunBrainForMessageResult {
  text: string;
  conversationId: string;
}

export async function runBrainForMessage(
  input: RunBrainForMessageInput,
): Promise<RunBrainForMessageResult> {
  const { admin, userId, message } = input;
  const deviceKind = input.deviceKind ?? "web";

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, google_access_token")
    .eq("id", userId)
    .single();

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const embed = makeVoyageEmbed(process.env.VOYAGE_API_KEY!);

  const conversationId = await resolveOrCreateConversation(admin, userId);

  const history = await loadHistory(admin, conversationId, userId);

  await admin.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: message,
  });

  let text = "";
  const toolCalls: { name: string; input: unknown; id: string }[] = [];
  let finalStopReason = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;

  const queueClientAction = async (args: { toolName: string; toolArgs: unknown }) => {
    const { data, error } = await admin
      .from("pending_client_actions")
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        source: input.followupChannel ?? "web",
        notify_channel: input.followupChannel ?? null,
        notify_to_e164: input.followupToE164 ?? null,
        tool_name: args.toolName,
        tool_args: args.toolArgs as Record<string, unknown>,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`queue client action failed: ${error?.message ?? "no row"}`);
    return { id: data.id as string };
  };

  const availableSkills = await loadSkillIndex(SKILLS_DIR);
  const brainInput = {
    anthropic,
    supabase: admin,
    embed,
    userId,
    deviceKind,
    conversationHistory: history,
    userMessage: message,
    dispatchNotification: (id: string) => dispatchNotification(admin, id),
    queueClientAction,
    executeBrowserAction,
    availableSkills,
    loadSkillBody: (name: string) => loadSkillBody(SKILLS_DIR, name),
    installSkill: (source: string) => installSkill(source, SKILLS_DIR),
    previewSkill,
    execSkillScript: (args: Parameters<typeof execSkillScript>[1]) => execSkillScript(SKILLS_DIR, args),
    ...(profile?.display_name ? { userName: profile.display_name } : {}),
    ...(profile?.google_access_token ? { googleAccessToken: profile.google_access_token } : {}),
  };

  for await (const event of runBrain(brainInput)) {
    if (event.type === "text_delta") text += event.text;
    else if (event.type === "tool_use")
      toolCalls.push({ name: event.name, input: event.input, id: event.id });
    else if (event.type === "done") {
      finalStopReason = event.stopReason;
      inputTokens = event.usage.input_tokens;
      outputTokens = event.usage.output_tokens;
      cacheReadTokens = event.usage.cache_read_input_tokens ?? null;
    } else if (event.type === "error") {
      throw new Error(event.error);
    }
  }

  if (finalStopReason === "client_followup_required") {
    text = text.trim()
      ? text + "\n\n(I tried to use a device tool that needs the desktop app — not available from WhatsApp yet.)"
      : "I can't run that from WhatsApp yet — it needs the desktop app. Ask me something that doesn't need device control.";
  }

  await admin.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content: text,
    tool_calls: toolCalls.length ? toolCalls : null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
  });

  await admin
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return { text, conversationId };
}

async function resolveOrCreateConversation(admin: SupabaseClient, userId: string): Promise<string> {
  const cutoff = new Date(Date.now() - CONTINUE_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(1);
  const first = recent?.[0];
  if (first) return first.id as string;

  const { data: conv, error } = await admin
    .from("conversations")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error || !conv) throw new Error(`failed to create conversation: ${error?.message ?? "no row"}`);
  return conv.id as string;
}

async function loadHistory(
  admin: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await admin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);
  if (!data) return [];
  return data.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content as string,
  }));
}
