// Server-side runner for the writer agent. Loads a queued writing task, runs
// an Anthropic call with web_search (for optional context lookup on recipients
// / companies), writes the draft to tasks.result, and queues a WhatsApp ping
// if the task was created with notify=true.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";

type WriterArgs = {
  title?: string;
  format?: "email" | "linkedin_post" | "whatsapp_reply" | "tweet" | "cold_outreach" | "general";
  recipient?: string;
  tone?: string;
  length?: "short" | "medium" | "long";
  notify?: boolean;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4096;
const MAX_STEPS = 10;
const MAX_WEB_SEARCHES = 3;

export async function runWriterTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[writer-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[writer-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: WriterArgs = task.args ?? {};
  const notify = args.notify ?? true;
  const format = args.format ?? "general";
  const length = args.length ?? "medium";

  const voice = await loadBrandVoice(admin, task.user_id);

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
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

  const systemPrompt = buildSystemPrompt({
    format,
    length,
    recipient: args.recipient ?? null,
    tone: args.tone ?? null,
    voice,
  });

  let result = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: task.prompt },
  ];

  // web_search available but optional — the writer uses it for cold outreach
  // or when the brief references a specific company/person the writer needs
  // to know about. For most drafts it won't be called.
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

      let assistantText = "";
      for (const block of response.content) {
        if (block.type === "text") {
          assistantText += block.text;
          if (block.text.trim()) await emit("text", block.text);
        } else if (block.type === "tool_use" || block.type === "server_tool_use") {
          await emit("tool_use", null, {
            name: block.name,
            input: block.input,
            id: block.id,
          });
        } else if (block.type === "web_search_tool_result") {
          const items = Array.isArray(block.content) ? block.content : [];
          const summary = items
            .map((it) => (it.type === "web_search_result" ? `• ${it.title} — ${it.url}` : ""))
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
        result = assistantText.trim() + "\n\n[Draft truncated — hit max tokens]";
        break;
      }

      if (response.stop_reason === "tool_use") {
        const clientToolUses = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
        );
        if (clientToolUses.length === 0) continue;
        const unknown = clientToolUses.map((t) => t.name).join(", ");
        throw new Error(`writer tried to use unknown client tool: ${unknown}`);
      }

      break;
    }

    const costUsd = estimateCost(inputTokens, outputTokens, cacheReadTokens);

    const finalDraft = extractDraft(result);

    await admin
      .from("tasks")
      .update({
        status: "needs_approval",
        needs_approval_at: new Date().toISOString(),
        result: finalDraft,
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

function buildSystemPrompt(opts: {
  format: WriterArgs["format"];
  length: "short" | "medium" | "long";
  recipient: string | null;
  tone: string | null;
  voice: BrandVoice | null;
}): string {
  const lengthHint =
    opts.length === "short"
      ? "Keep it tight — 2-4 sentences for messages, 50-80 words for posts."
      : opts.length === "long"
        ? "Fuller treatment — 150-300 words for posts, longer emails are fine when warranted."
        : "Medium length — 80-150 words, enough to land the point without padding.";

  const formatHint = formatGuidance(opts.format ?? "general");
  const nameLine = "Writing as: Reiss (solo non-technical founder of SevenPoint AI, British).";
  const recipientLine = opts.recipient ? `Recipient: ${opts.recipient}.` : "";
  const toneLine = opts.tone
    ? `Tone directive from the user (overrides default): "${opts.tone}".`
    : "Default tone: warm, direct, British English, no corporate filler, no em-dashes in casual formats.";

  const voiceBlock = renderVoiceBlock(opts.voice, opts.format);

  return [
    "You are the writer agent in Vance, Reiss's multi-agent personal assistant.",
    "Your job: produce a polished, ready-to-send draft from the user's brief. You are NOT",
    "a conversational assistant — you produce ONE draft as output, not a discussion.",
    "",
    nameLine,
    recipientLine,
    toneLine,
    lengthHint,
    "",
    voiceBlock,
    "",
    "Format guidance:",
    formatHint,
    "",
    "General rules:",
    "- Sound like a human, not a template. No 'I hope this email finds you well' nonsense.",
    "- Be specific where the brief is specific. Do not invent facts, numbers, or commitments.",
    "- If the brief is missing something critical (e.g. a price, a date), leave a [bracketed",
    "  placeholder] rather than guessing.",
    "- web_search is available for looking up a specific company/person ONLY if the brief",
    "  clearly needs it (e.g. cold outreach to NamedCo). Don't search for generic context.",
    "",
    "Output contract:",
    "Put the final draft inside a <draft>...</draft> block. You may precede it with a",
    "one-line note about assumptions if needed, but the draft itself must be copy-paste",
    "ready — no commentary, no meta, no 'here's your draft' preamble inside the block.",
    "For emails, include a subject line before the body, separated by a blank line, inside",
    "the <draft> block.",
  ]
    .filter(Boolean)
    .join("\n");
}

type BrandVoice = {
  tone_keywords: string[];
  avoid_words: string[];
  greeting: string | null;
  signature: string | null;
  voice_notes: string | null;
  sample_email: string | null;
  sample_message: string | null;
  sample_post: string | null;
};

async function loadBrandVoice(admin: SupabaseClient, userId: string): Promise<BrandVoice | null> {
  const { data } = await admin
    .from("brand_voice")
    .select("tone_keywords, avoid_words, greeting, signature, voice_notes, sample_email, sample_message, sample_post")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return data as BrandVoice;
}

function renderVoiceBlock(voice: BrandVoice | null, format: WriterArgs["format"]): string {
  if (!voice) return "";
  const lines: string[] = [];
  if (voice.tone_keywords.length > 0) {
    lines.push(`Voice keywords: ${voice.tone_keywords.join(", ")}.`);
  }
  if (voice.avoid_words.length > 0) {
    lines.push(`Avoid these words/phrases: ${voice.avoid_words.join(", ")}.`);
  }
  if (voice.greeting) lines.push(`Default greeting style: ${voice.greeting}`);
  if (voice.signature) lines.push(`Sign-off: ${voice.signature}`);
  if (voice.voice_notes) {
    lines.push("Voice notes:");
    lines.push(voice.voice_notes);
  }
  const sample = pickSample(voice, format);
  if (sample) {
    lines.push("");
    lines.push("Sample of how the user actually writes (study tone, sentence rhythm, sign-off — DO NOT copy content):");
    lines.push("---");
    lines.push(sample);
    lines.push("---");
  }
  if (lines.length === 0) return "";
  return ["USER VOICE CONFIG (apply to this draft):", ...lines].join("\n");
}

function pickSample(voice: BrandVoice, format: WriterArgs["format"]): string | null {
  if (format === "email" || format === "cold_outreach") return voice.sample_email ?? voice.sample_message ?? null;
  if (format === "linkedin_post" || format === "tweet") return voice.sample_post ?? voice.sample_email ?? null;
  if (format === "whatsapp_reply") return voice.sample_message ?? voice.sample_email ?? null;
  return voice.sample_email ?? voice.sample_post ?? voice.sample_message ?? null;
}

function formatGuidance(format: NonNullable<WriterArgs["format"]>): string {
  switch (format) {
    case "email":
      return [
        "- Email: subject line on first line (just the subject, no 'Subject:' prefix), then",
        "  blank line, then body. Sign off simply ('Reiss' or '— Reiss'). No long signatures.",
      ].join("\n");
    case "linkedin_post":
      return [
        "- LinkedIn post: strong first line (the scroll-stopper), then punchy paragraphs.",
        "  Use short sentences. Line breaks between paragraphs. Avoid hashtag spam — 2-3",
        "  relevant hashtags max at the end if any.",
      ].join("\n");
    case "whatsapp_reply":
      return [
        "- WhatsApp reply: short, conversational, lowercase-friendly, no formal sign-off.",
        "  Reads like a real person texting. No markdown.",
      ].join("\n");
    case "tweet":
      return [
        "- Tweet: ≤280 characters. One strong idea. No hashtags unless the brief asks for",
        "  one. Plain text only.",
      ].join("\n");
    case "cold_outreach":
      return [
        "- Cold outreach: 4-7 lines max. Clear reason for reaching out (specific to them,",
        "  not generic), one specific ask or next step, easy to reply to. Avoid 'I came",
        "  across your profile' / 'quick question' openers.",
      ].join("\n");
    default:
      return "- General copy: match the brief's evident format; clean, no boilerplate.";
  }
}

function extractDraft(text: string): string {
  const match = text.match(/<draft>([\s\S]*?)<\/draft>/i);
  if (match && match[1]) return match[1].trim();
  // Model didn't use the tags — fall back to full text so we don't lose the work.
  return text.trim();
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

  const label = title ? `"${title}"` : "your draft";
  const body = `✍️ Draft ready: ${label}. Open JARVIS → Tasks to review.`;

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
    console.warn("[writer-run] failed to queue notification:", error?.message);
    return;
  }

  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[writer-run] dispatch failed:", e);
  }
}
