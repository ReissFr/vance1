// Server-side runner for the outreach agent. Loads a queued outreach task and
// produces a personalized draft per prospect in parallel (capped concurrency).
// Stores the drafts as structured JSON in tasks.result. Approval creates N
// Gmail drafts in one click (handled by /api/tasks/[id]/approve).

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";

type Prospect = {
  name: string;
  email: string;
  company?: string;
  role?: string;
  context?: string;
};

type OutreachArgs = {
  title?: string;
  campaign_goal?: string;
  prospects?: Prospect[];
  tone?: string;
  notify?: boolean;
};

export type OutreachDraft = {
  prospect: Prospect;
  subject: string;
  body: string;
  error?: string;
};

export type OutreachResult = {
  campaign_goal: string;
  drafts: OutreachDraft[];
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1024;
const CONCURRENCY = 3;

export async function runOutreachTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[outreach-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[outreach-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: OutreachArgs = task.args ?? {};
  const notify = args.notify ?? true;
  const prospects = args.prospects ?? [];
  const campaignGoal = args.campaign_goal ?? task.prompt;

  if (prospects.length === 0) {
    await admin
      .from("tasks")
      .update({
        status: "failed",
        error: "No prospects provided",
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    return;
  }

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", taskId);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const systemPrompt = buildSystemPrompt({
    campaignGoal,
    tone: args.tone ?? null,
  });

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;

  const emit = async (
    kind: "text" | "progress" | "error",
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

  const draftForProspect = async (p: Prospect): Promise<OutreachDraft> => {
    const userMsg = [
      `Prospect: ${p.name}`,
      p.role ? `Role: ${p.role}` : "",
      p.company ? `Company: ${p.company}` : "",
      p.context ? `Context: ${p.context}` : "",
      "",
      "Draft the cold outreach email for this prospect.",
    ]
      .filter(Boolean)
      .join("\n");

    let model = MODEL;
    let modelSwitched = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: "user", content: userMsg }],
        });
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;
        totalCacheRead += response.usage.cache_read_input_tokens ?? 0;

        const text = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        const { subject, body } = parseDraft(text);
        if (!subject || !body) {
          return {
            prospect: p,
            subject: subject || "(missing subject)",
            body: body || text.trim(),
            error: subject && body ? undefined : "Could not parse subject/body cleanly",
          };
        }
        return { prospect: p, subject, body };
      } catch (e) {
        if (!modelSwitched && isOverloadedError(e)) {
          modelSwitched = true;
          model = FALLBACK_MODEL;
          await emit("progress", `[${p.email}] switched to ${FALLBACK_MODEL}`);
          continue;
        }
        const msg = e instanceof Error ? e.message : String(e);
        return { prospect: p, subject: "", body: "", error: msg };
      }
    }
    return { prospect: p, subject: "", body: "", error: "unknown failure" };
  };

  // Bounded concurrency.
  const drafts: OutreachDraft[] = new Array(prospects.length);
  const queue = prospects.map((p, i) => ({ p, i }));
  const workers = Array.from({ length: Math.min(CONCURRENCY, prospects.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      await emit("progress", `drafting for ${next.p.name} <${next.p.email}>`);
      drafts[next.i] = await draftForProspect(next.p);
    }
  });
  await Promise.all(workers);

  const result: OutreachResult = { campaign_goal: campaignGoal, drafts };
  const costUsd = estimateCost(totalInput, totalOutput, totalCacheRead);

  const anyFailed = drafts.some((d) => d.error);
  await admin
    .from("tasks")
    .update({
      status: "needs_approval",
      needs_approval_at: new Date().toISOString(),
      result: JSON.stringify(result),
      completed_at: new Date().toISOString(),
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_read_tokens: totalCacheRead,
      cost_usd: costUsd,
      error: anyFailed ? "Some drafts had issues — review before sending" : null,
    })
    .eq("id", taskId);

  if (notify) await queueCompletionNotification(admin, task.user_id, taskId, args.title, drafts.length);
}

function buildSystemPrompt(opts: {
  campaignGoal: string;
  tone: string | null;
}): string {
  const toneLine = opts.tone
    ? `Tone directive: "${opts.tone}".`
    : "Default tone: warm, direct, respectful of their time, British English, no corporate filler.";

  return [
    "You are the outreach agent in Vance, Reiss's multi-agent personal assistant.",
    "Your job: draft a personalized cold outreach email for ONE prospect at a time.",
    "",
    "Writing as: Reiss (solo non-technical founder of SevenPoint AI, British).",
    toneLine,
    "",
    "Campaign brief (same for every prospect in this run):",
    opts.campaignGoal,
    "",
    "Per-prospect personalization rules:",
    "- Lead with something SPECIFIC about this prospect — their role, company, or the",
    "  context Reiss gave. If there's no specific hook, acknowledge it's cold rather than",
    "  faking familiarity.",
    "- Keep it to 4-7 lines. Nobody reads long cold emails.",
    "- One clear ask. 'Worth a 15-min call next week?' or 'Want early beta access?' —",
    "  something easy to reply yes/no to.",
    "- Avoid 'I came across your profile', 'I hope this finds you well', 'quick question'.",
    "- Don't oversell. Under-promising earns more replies than hype.",
    "- Do NOT invent facts about the prospect or fabricate shared connections.",
    "",
    "Output contract (strict):",
    "Line 1: the subject line (short, specific, lowercase-friendly — no 'RE:' or",
    "        'Quick question').",
    "Line 2: blank.",
    "Line 3+: the body. Sign off simply — 'Reiss' or '— Reiss' — no long signatures.",
    "",
    "Do NOT wrap in tags, code blocks, or commentary. Just subject, blank line, body.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseDraft(text: string): { subject: string; body: string } {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return { subject: "", body: "" };
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmpty === -1) return { subject: "", body: "" };
  const subject = (lines[firstNonEmpty] ?? "").replace(/^subject:\s*/i, "").trim();
  const rest = lines.slice(firstNonEmpty + 1).join("\n").replace(/^\s*\n/, "").trim();
  return { subject, body: rest };
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
  draftCount: number,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return;

  const label = title ? `"${title}"` : "outreach campaign";
  const body = `📬 ${draftCount} drafts ready: ${label}. Open JARVIS → Tasks to review and batch-create Gmail drafts.`;

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
    console.warn("[outreach-run] dispatch failed:", e);
  }
}
