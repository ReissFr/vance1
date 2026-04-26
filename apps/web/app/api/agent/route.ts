import Anthropic from "@anthropic-ai/sdk";
import {
  runBrain,
  makeVoyageEmbed,
  loadSkillIndex,
  loadSkillBody,
  installSkill,
  previewSkill,
  execSkillScript,
  makeCachedEmbed,
  loadCompressedHistory,
  extractAndSaveFacts,
  type BrainEvent,
} from "@jarvis/agent";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notify";
import { executeBrowserAction } from "@/lib/browser";
import { disabledToolNamesForUser } from "@/lib/user-features";
import { NextResponse, type NextRequest } from "next/server";
import { join } from "node:path";

const SKILLS_DIR = join(process.cwd(), "skills");

export const runtime = "nodejs";
export const maxDuration = 60;

const HISTORY_LIMIT = 30;
const TITLE_MODEL = "claude-haiku-4-5-20251001";

interface AgentRequestBody {
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  deviceKind?: string;
  screenshotB64?: string | null;
  screenContext?: { app: string; text: string; capturedAt: number } | null;
  conversationId?: string | null;
  isFollowup?: boolean;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as AgentRequestBody;
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, google_access_token")
    .eq("id", user.id)
    .single();

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  // Cached embed: dedupes within a turn AND hits Supabase-backed vector cache.
  // Saves one Voyage call per repeat user message / skill lookup / learning lookup.
  const embed = makeCachedEmbed(admin, makeVoyageEmbed(process.env.VOYAGE_API_KEY!));

  // Resolve or create conversation.
  let conversationId = body.conversationId ?? null;
  let isNewConversation = false;
  if (!conversationId) {
    const { data: conv, error } = await admin
      .from("conversations")
      .insert({ user_id: user.id })
      .select("id")
      .single();
    if (error || !conv) {
      return NextResponse.json({ error: "failed to create conversation" }, { status: 500 });
    }
    conversationId = conv.id as string;
    isNewConversation = true;
  }

  // Load history: pull only the turns newer than any existing distilled
  // summary. Long conversations collapse into {summary} + {recent 12 turns}
  // instead of 30 raw messages — cuts per-round input tokens dramatically.
  const compressed = await loadCompressedHistory(admin, anthropic, {
    conversationId,
    userId: user.id,
  }).catch(() => ({ summary: null, recent: [] as { role: "user" | "assistant"; content: string }[] }));
  const history =
    compressed.recent.length > 0
      ? compressed.recent
      : await loadHistory(admin, conversationId, user.id, body.history ?? []);
  const historySummary = compressed.summary;

  // Persist the user turn (unless this is an internal followup carrying tool results back).
  if (!body.isFollowup) {
    await admin.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: body.message,
    });
    await admin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      send({ type: "conversation", id: conversationId });

      let accumulatedText = "";
      const toolCalls: { name: string; input: unknown; id: string }[] = [];
      let finalStopReason = "";
      let finalUsage: Anthropic.Messages.Usage | undefined;

      try {
        const availableSkills = await loadSkillIndex(SKILLS_DIR);
        const disabledToolNames = await disabledToolNamesForUser(admin, user.id);
        const brainInput = {
          anthropic,
          supabase: admin,
          embed,
          userId: user.id,
          deviceKind: body.deviceKind === "mac" ? "mac" : "web",
          conversationHistory: history,
          userMessage: body.message,
          dispatchNotification: (id: string) => dispatchNotification(admin, id),
          executeBrowserAction: (action: Parameters<typeof executeBrowserAction>[0]) =>
            executeBrowserAction(action, { userId: user.id }),
          availableSkills,
          loadSkillBody: (name: string) => loadSkillBody(SKILLS_DIR, name),
          installSkill: (source: string) => installSkill(source, SKILLS_DIR),
          previewSkill,
          execSkillScript: (args: Parameters<typeof execSkillScript>[1]) => execSkillScript(SKILLS_DIR, args),
          ...(profile?.display_name ? { userName: profile.display_name } : {}),
          ...(user.email ? { userEmail: user.email } : {}),
          ...(profile?.google_access_token
            ? { googleAccessToken: profile.google_access_token }
            : {}),
          ...(body.screenshotB64 ? { userScreenshotB64: body.screenshotB64 } : {}),
          ...(body.screenContext ? { screenContext: body.screenContext } : {}),
          ...(disabledToolNames.length ? { disabledToolNames } : {}),
          ...(historySummary ? { historySummary } : {}),
        };
        for await (const event of runBrain(brainInput)) {
          send(event as unknown as Record<string, unknown>);
          if (event.type === "text_delta") accumulatedText += event.text;
          else if (event.type === "tool_use")
            toolCalls.push({ name: event.name, input: event.input, id: event.id });
          else if (event.type === "done") {
            finalStopReason = event.stopReason;
            finalUsage = event.usage;
          }
        }
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : String(err) } satisfies BrainEvent);
      } finally {
        // Persist assistant turn when the stream ended without pending client followup.
        // Followup-pending turns are not saved — the next POST carries the rest and its final
        // reply is what gets persisted.
        if (finalStopReason && finalStopReason !== "client_followup_required") {
          await admin.from("messages").insert({
            conversation_id: conversationId,
            user_id: user.id,
            role: "assistant",
            content: accumulatedText,
            tool_calls: toolCalls.length ? toolCalls : null,
            input_tokens: finalUsage?.input_tokens ?? null,
            output_tokens: finalUsage?.output_tokens ?? null,
            cache_read_tokens: finalUsage?.cache_read_input_tokens ?? null,
          });
          await admin
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId);

          // Auto-title on the first completed exchange (fire-and-forget).
          if (isNewConversation && body.message.trim() && accumulatedText.trim()) {
            void autoTitle(
              admin,
              anthropic,
              conversationId!,
              body.message,
              accumulatedText,
            ).catch(() => {});
          }

          // Passive fact extraction (fire-and-forget). After every completed
          // turn, run a Haiku pass to pull durable facts the brain didn't
          // bother to save_memory itself. Deduped against existing memories.
          if (body.message.trim() && accumulatedText.trim()) {
            void extractAndSaveFacts(
              anthropic,
              admin,
              embed,
              user.id,
              body.message,
              accumulatedText,
            ).catch((e) => {
              console.warn("[agent] extractAndSaveFacts failed:", e);
            });
          }
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function loadHistory(
  admin: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  userId: string,
  fallback: { role: "user" | "assistant"; content: string }[],
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await admin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);
  if (!data || data.length === 0) return fallback;
  return data.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content as string,
  }));
}

async function autoTitle(
  admin: ReturnType<typeof supabaseAdmin>,
  anthropic: Anthropic,
  conversationId: string,
  userMsg: string,
  assistantMsg: string,
) {
  const res = await anthropic.messages.create({
    model: TITLE_MODEL,
    max_tokens: 24,
    system: "Title this conversation in 3-6 words. Plain text, no quotes, no trailing punctuation.",
    messages: [
      { role: "user", content: `User: ${userMsg.slice(0, 400)}\n\nAssistant: ${assistantMsg.slice(0, 400)}` },
    ],
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return;
  const title = block.text.trim().replace(/^["']|["']$/g, "").slice(0, 80);
  if (!title) return;
  await admin.from("conversations").update({ title }).eq("id", conversationId);
}
