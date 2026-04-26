import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_IDS, type ModelTier } from "@jarvis/types";
import { pickModel } from "./router";
import { systemPrompt } from "./prompt";
import { toolsForDevice, TOOLS_BY_NAME, asAnthropicTool, type ToolContext, type QueueClientActionArgs, type BrowserAction, type BrowserResult } from "./tools";
import { recallMemories, recentMemories, pinnedMemories } from "./memory";
import type { SkillMetadata, SkillBody } from "./skills";
import {
  normaliseIntent,
  lookupCached,
  saveCached,
  lookupSkills,
  saveSkill,
  recordRun,
  lookupLearnings,
  lookupFailures,
  saveFailure,
  lookupToolResult,
  rememberToolResult,
  invalidateForWrite,
  TrajectoryRecorder,
  classifyIntent,
  pruneTools,
  type LearnedSkill,
  type SharedLearning,
  type SkillFailure,
} from "./costlayer";

export interface BrainInput {
  anthropic: Anthropic;
  supabase: SupabaseClient;
  embed: (text: string) => Promise<number[]>;
  userId: string;
  userName?: string;
  userEmail?: string;
  googleAccessToken?: string;
  deviceKind: string;
  conversationHistory: Anthropic.Messages.MessageParam[];
  userMessage: string;
  userScreenshotB64?: string;
  // Compressed summary of turns older than the live history window. Route
  // computes this via loadCompressedHistory; prompt surfaces it in place of
  // the omitted turns.
  historySummary?: string | null;
  // Ambient on-device OCR of whatever window is frontmost on the user's Mac.
  // Cheap (text only), included as a context preamble when present so the
  // brain can answer "what's this email about?" without a tool round.
  screenContext?: { app: string; text: string; capturedAt: number };
  // Tool names disabled by the user in the feature library. Dropped from the
  // tool list before the turn runs so the brain never sees them.
  disabledToolNames?: string[];
  forcedTier?: ModelTier;
  dispatchNotification?: (notificationId: string) => Promise<void>;
  queueClientAction?: (args: QueueClientActionArgs) => Promise<{ id: string }>;
  executeBrowserAction?: (action: BrowserAction) => Promise<BrowserResult>;
  availableSkills?: SkillMetadata[];
  loadSkillBody?: (name: string) => Promise<SkillBody | null>;
  installSkill?: (source: string) => Promise<{ name: string; dir: string; files: number }>;
  previewSkill?: (source: string) => Promise<{
    name: string;
    description: string;
    body: string;
    source: string;
    fileCount: number;
    hasScripts: boolean;
    securityStatus?: string | null;
    securityWarning?: string | null;
  }>;
  execSkillScript?: (args: {
    skill: string;
    script: string;
    args?: string[];
    stdin?: string;
    timeoutSec?: number;
  }) => Promise<{
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    runDir: string;
    outputs: string[];
    timedOut?: boolean;
    error?: string;
  }>;
}

export type BrainEvent =
  | { type: "model"; tier: ModelTier; reason: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string; input: unknown; id: string }
  | { type: "tool_result"; id: string; result: unknown; error?: string }
  | { type: "done"; stopReason: string; usage: Anthropic.Messages.Usage }
  | { type: "error"; error: string };

const MAX_TOOL_ROUNDS = 12;

function extractBase64Image(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  // Browser tools return { imageB64: "..." } directly.
  if (typeof r.imageB64 === "string" && r.imageB64.length > 0) return r.imageB64;
  // Legacy native screenshot tools return { output: "data:image/jpeg;base64,..." }.
  const output = (r.output ?? (r.result as Record<string, unknown>)?.output) as string | undefined;
  if (typeof output !== "string") return null;
  const prefix = "data:image/jpeg;base64,";
  if (output.startsWith(prefix)) return output.slice(prefix.length);
  return null;
}

export async function* runBrain(input: BrainInput): AsyncGenerator<BrainEvent> {
  const decision = pickModel({ userMessage: input.userMessage, forcedTier: input.forcedTier, deviceKind: input.deviceKind });

  // ---------------------------------------------------------------------
  // Cost layer: derive one embedding of the user message and use it to
  // (a) try the semantic result cache, (b) look up matching learned skills
  // across the shared library, (c) fetch site-specific learnings.
  // All three are best-effort — failures must never block the turn.
  // ---------------------------------------------------------------------
  const intent = normaliseIntent(input.userMessage);
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await input.embed(input.userMessage);
  } catch {
    queryEmbedding = null;
  }

  // Cache hit: the only path that skips the model entirely. We only consult
  // the cache when there's no screen/image context — those turns are
  // inherently fresh.
  if (queryEmbedding && !input.userScreenshotB64 && !input.screenContext) {
    try {
      const cached = await lookupCached(input.supabase, {
        userId: input.userId,
        userMessage: input.userMessage,
        queryEmbedding,
      });
      if (cached) {
        yield { type: "model", tier: "haiku", reason: `cache hit (${cached.category})` };
        yield { type: "text_delta", text: cached.answer };
        yield {
          type: "done",
          stopReason: "cache_hit",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          } as Anthropic.Messages.Usage,
        };
        return;
      }
    } catch {
      // ignore; fall through to full inference
    }
  }

  let matchedSkills: LearnedSkill[] = [];
  let siteLearnings: SharedLearning[] = [];
  let skillFailures: SkillFailure[] = [];
  let replayCandidate: LearnedSkill | null = null;

  // Negative cache — known-bad approaches for this intent/site. Surfaced in
  // the prompt so the brain skips dead ends. Exact-match only (high precision).
  try {
    skillFailures = await lookupFailures(input.supabase, {
      fingerprint: intent.fingerprint,
      site: intent.site,
      limit: 5,
    });
  } catch {
    skillFailures = [];
  }

  if (queryEmbedding) {
    try {
      matchedSkills = await lookupSkills(input.supabase, {
        userId: input.userId,
        fingerprint: intent.fingerprint,
        intentEmbedding: queryEmbedding,
        site: intent.site,
        topK: 3,
      });
      replayCandidate =
        matchedSkills.find((s) => s.status === "verified" && (s.similarity ?? 1) >= 0.80) ??
        null;
    } catch {
      matchedSkills = [];
    }
    try {
      siteLearnings = await lookupLearnings(input.supabase, {
        intentEmbedding: queryEmbedding,
        site: intent.site,
        topK: 5,
      });
    } catch {
      siteLearnings = [];
    }
  }

  // If we have a high-confidence verified skill and the router picked Sonnet
  // purely to drive the browser, drop to Haiku — replaying recorded steps
  // doesn't need the stronger model. Opus (user forced deep think) is left
  // alone.
  if (replayCandidate && decision.tier === "sonnet") {
    decision.tier = "haiku" as ModelTier;
    decision.modelId = MODEL_IDS.haiku;
    decision.reason = `verified skill match (${replayCandidate.name}) — replaying with cheap tier`;
  }
  yield { type: "model", tier: decision.tier, reason: decision.reason };

  // Memories get three lookups merged: (a) pinned memories (always carried,
  // regardless of topic — hard constraints, identity facts), (b) top-6
  // semantically similar to this turn, (c) 3 most-recently-saved. Pinned goes
  // first so it survives any downstream truncation.
  const fetchJarvisMode = async (): Promise<"assistant" | "ceo"> => {
    try {
      const { data } = await input.supabase
        .from("profiles")
        .select("jarvis_mode")
        .eq("id", input.userId)
        .single();
      const m = (data as { jarvis_mode?: string } | null)?.jarvis_mode;
      return m === "ceo" ? "ceo" : "assistant";
    } catch {
      return "assistant";
    }
  };

  const [pinnedMems, semanticMems, recentMems, jarvisMode] = await Promise.all([
    pinnedMemories(input.supabase, input.userId, 40).catch(() => []),
    recallMemories(input.supabase, input.embed, {
      userId: input.userId,
      query: input.userMessage,
      topK: 6,
    }).catch(() => []),
    recentMemories(input.supabase, input.userId, 3).catch(() => []),
    fetchJarvisMode(),
  ]);
  const seen = new Set<string>();
  const mergedMems = [...pinnedMems, ...semanticMems, ...recentMems].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  const sysText = systemPrompt({
    ...(input.userName ? { userName: input.userName } : {}),
    ...(input.userEmail ? { userEmail: input.userEmail } : {}),
    deviceKind: input.deviceKind,
    recentMemories: mergedMems.map((m) => `[${m.kind}] ${m.content}`),
    currentDateISO: new Date().toISOString(),
    ...(input.availableSkills
      ? { availableSkills: input.availableSkills.map((s) => ({ name: s.name, description: s.description })) }
      : {}),
    ...(matchedSkills.length
      ? {
          learnedSkills: matchedSkills.map((s) => ({
            name: s.name,
            description: s.description,
            intent: s.intent,
            site: s.site,
            variables: s.variables,
            steps: s.steps.steps,
            ...(s.similarity !== undefined ? { similarity: s.similarity } : {}),
            verified: s.status === "verified",
          })),
        }
      : {}),
    ...(siteLearnings.length
      ? {
          siteLearnings: siteLearnings.map((l) => ({
            scope: l.scope,
            fact: l.fact,
            category: l.category,
          })),
        }
      : {}),
    ...(skillFailures.length
      ? { skillFailures: skillFailures.map((f) => ({ reason: f.reason, site: f.site })) }
      : {}),
    ...(input.historySummary ? { historySummary: input.historySummary } : {}),
    mode: jarvisMode,
  });

  const recorder = new TrajectoryRecorder();

  const disabledSet = input.disabledToolNames && input.disabledToolNames.length
    ? new Set(input.disabledToolNames)
    : null;
  // Dynamic tool pruning: classify the message into category hints and drop
  // tools that don't match. Pruning changes the tools block, which busts
  // the prompt cache for this turn. We only prune when:
  //   - this is the first turn of a conversation (no warm cache to lose), AND
  //   - the classifier fired a narrow (1–3 categories) match.
  // For later turns we keep the full tool list so cache reads stay cheap.
  const allDeviceTools = toolsForDevice(input.deviceKind, { disabledToolNames: disabledSet });
  // Tool pruning disabled pending refinement. When the classifier fires on
  // "browser" it also needs to keep mac_device tools (open_url, launch_app)
  // as a fallback — the brain uses those when browser_open isn't available.
  const canPrune = false && input.conversationHistory.length === 0;
  const classification = canPrune ? classifyIntent(input.userMessage) : null;
  const prunedTools = classification
    ? pruneTools(allDeviceTools, classification)
    : allDeviceTools;
  const tools = prunedTools.map(asAnthropicTool);
  const toolCtx: ToolContext = {
    userId: input.userId,
    supabase: input.supabase,
    ...(input.googleAccessToken !== undefined ? { googleAccessToken: input.googleAccessToken } : {}),
    embed: input.embed,
    ...(input.dispatchNotification ? { dispatchNotification: input.dispatchNotification } : {}),
    ...(input.queueClientAction ? { queueClientAction: input.queueClientAction } : {}),
    ...(input.executeBrowserAction ? { executeBrowserAction: input.executeBrowserAction } : {}),
    ...(input.loadSkillBody ? { loadSkillBody: input.loadSkillBody } : {}),
    ...(input.installSkill ? { installSkill: input.installSkill } : {}),
    ...(input.previewSkill ? { previewSkill: input.previewSkill } : {}),
    ...(input.execSkillScript ? { execSkillScript: input.execSkillScript } : {}),
  };

  const screenPreamble = input.screenContext && input.screenContext.text.trim()
    ? `[ambient screen context — frontmost window: ${input.screenContext.app}]\n${input.screenContext.text.slice(0, 4000)}\n[end screen context]\n\n`
    : "";
  const messageText = screenPreamble + input.userMessage;

  const userContent: Anthropic.Messages.ContentBlockParam[] | string = input.userScreenshotB64
    ? [
        { type: "text", text: messageText },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: input.userScreenshotB64,
          },
        },
      ]
    : messageText;

  const messages: Anthropic.Messages.MessageParam[] = [
    ...input.conversationHistory,
    { role: "user", content: userContent },
  ];

  // Cache the tools block too: tool definitions are stable across turns and
  // hundreds of lines, so they're worth their own cache breakpoint. Tagging
  // the last tool marks the end of a cached section.
  const cachedTools = tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  ) as Anthropic.Messages.Tool[];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = input.anthropic.messages.stream({
      model: decision.modelId,
      max_tokens: 4096,
      system: [
        // Stable cached block — reused across turns within the 5-minute window.
        { type: "text", text: sysText, cache_control: { type: "ephemeral" } },
      ],
      tools: cachedTools,
      messages,
    });

    let assistantBlocks: Anthropic.Messages.ContentBlock[] = [];
    let stopReason = "";
    let usage: Anthropic.Messages.Usage | undefined;
    // Buffer text rather than streaming it. We only release text from rounds
    // that have NO tool calls (i.e. the final round). This stops the model's
    // mid-task narration ("Let me click that…") from reaching the user even
    // when it ignores the prompt-level SILENCE RULE.
    let bufferedText = "";

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          bufferedText += event.delta.text;
        }
      }
      const final = await stream.finalMessage();
      assistantBlocks = final.content;
      stopReason = final.stop_reason ?? "";
      usage = final.usage;
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    messages.push({ role: "assistant", content: assistantBlocks });

    const toolUses = assistantBlocks.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // Final round — release the full buffered response in one chunk.
      if (bufferedText) yield { type: "text_delta", text: bufferedText };
      yield { type: "done", stopReason, usage: usage! };

      // Cost-layer post-turn persistence (best-effort, fire-and-forget).
      // Successful end_turn → save trajectory (if long enough), cache answer
      // (if cacheable), log replay result (if we were replaying).
      void persistTurnLearnings({
        supabase: input.supabase,
        userId: input.userId,
        userMessage: input.userMessage,
        answer: bufferedText,
        queryEmbedding,
        intent,
        recorder,
        replayCandidate,
      }).catch(() => {});
      return;
    }
    // Intermediate round — discard buffered narration. The user does not see
    // "Let me click X / now I'll Y" running commentary between tool calls.

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    let expectsClientFollowup = false;
    for (const use of toolUses) {
      yield { type: "tool_use", id: use.id, name: use.name, input: use.input };
      recorder.push(use.name, use.input);
      const def = TOOLS_BY_NAME[use.name];
      if (!def) {
        const msg = `Unknown tool: ${use.name}`;
        recorder.markFailure();
        yield { type: "tool_result", id: use.id, result: null, error: msg };
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
        continue;
      }
      try {
        let result: unknown;
        const cached = lookupToolResult(input.userId, use.name, use.input);
        if (cached !== undefined) {
          result = cached;
        } else {
          result = await def.run(use.input, toolCtx);
          rememberToolResult(input.userId, use.name, use.input, result);
        }
        // Writes to shared state invalidate related read caches.
        invalidateForWrite(input.userId, use.name);
        if (
          result &&
          typeof result === "object" &&
          (result as { expects_followup?: unknown }).expects_followup === true
        ) {
          expectsClientFollowup = true;
        }
        yield { type: "tool_result", id: use.id, result };

        const b64 = extractBase64Image(result);
        if (b64) {
          const meta = result as { url?: string; title?: string };
          const header = [meta.url && `url: ${meta.url}`, meta.title && `title: ${meta.title}`]
            .filter(Boolean)
            .join(" — ");
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: [
              { type: "text", text: header || "Screenshot:" },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            ],
          });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(result),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[brain] tool ${use.name} failed:`, msg);
        recorder.markFailure();
        yield { type: "tool_result", id: use.id, result: null, error: msg };
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
      }
    }

    messages.push({ role: "user", content: toolResults });

    if (expectsClientFollowup) {
      yield { type: "done", stopReason: "client_followup_required", usage: usage! };
      return;
    }
  }

  yield { type: "error", error: `Exceeded ${MAX_TOOL_ROUNDS} tool rounds` };
}

// Write-through for the cost layer after a successful turn. Everything in
// here is optional: if any step fails the turn result to the user is
// unaffected. Called fire-and-forget from the done-path.
async function persistTurnLearnings(args: {
  supabase: SupabaseClient;
  userId: string;
  userMessage: string;
  answer: string;
  queryEmbedding: number[] | null;
  intent: ReturnType<typeof normaliseIntent>;
  recorder: TrajectoryRecorder;
  replayCandidate: LearnedSkill | null;
}): Promise<void> {
  const { supabase, userId, userMessage, answer, queryEmbedding, intent, recorder, replayCandidate } = args;

  // Log the replay outcome. If the recorder hit any tool errors during the
  // turn, count the replay as a failure and save a note in skill_failures so
  // the next user skips this approach.
  if (replayCandidate) {
    const hadErrors = recorder.errorCount > 0;
    try {
      await recordRun(supabase, {
        skillId: replayCandidate.id,
        userId,
        success: !hadErrors,
      });
    } catch { /* ignore */ }
    if (hadErrors) {
      await saveFailure(supabase, {
        userId,
        fingerprint: intent.fingerprint,
        site: intent.site,
        reason: `replay of "${replayCandidate.name}" hit ${recorder.errorCount} tool error(s)`,
        skillId: replayCandidate.id,
      });
    }
  }

  // If the brain ran a genuinely new multi-step trajectory, save it so the
  // next user with a similar intent can replay with Haiku.
  if (!replayCandidate && recorder.shouldSave() && queryEmbedding) {
    try {
      const name = intent.site
        ? `${intent.site}:${intent.text.split(" ").slice(0, 3).join("_") || "task"}`
        : intent.text.split(" ").slice(0, 4).join("_") || "task";
      await saveSkill(supabase, {
        userId,
        fingerprint: intent.fingerprint,
        name: name.slice(0, 60),
        intent: intent.text,
        intentEmbedding: queryEmbedding,
        site: intent.site,
        description: userMessage.slice(0, 140),
        trajectory: recorder.toTrajectory(),
      });
    } catch { /* ignore */ }
  }

  // Cache the final answer when the question looks cacheable.
  if (queryEmbedding && answer.trim()) {
    try {
      await saveCached(supabase, {
        userId,
        userMessage,
        queryEmbedding,
        answer,
      });
    } catch { /* ignore */ }
  }
}
