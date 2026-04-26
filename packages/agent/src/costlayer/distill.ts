import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueBatchRequest, registerFinisher } from "./batch";

// When a conversation exceeds this many message rows, the oldest half of
// those rows gets distilled into conversations.history_summary and replaced
// in the live history window with a single synthetic "summary" turn. Input
// tokens per round drop by 50–80% on long conversations.

const DISTILL_AT = 24;        // start distilling when we cross this many turns
const DISTILL_KEEP_RECENT = 12; // always keep the most recent N turns verbatim
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const SUMMARY_MAX_TOKENS = 400;

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface DistilledHistory {
  // One synthetic "system note" summarising everything older than the kept
  // recent window. Null if there's nothing to summarise yet.
  summary: string | null;
  // Timestamp of the newest turn the summary covers. Turns strictly after
  // this are loaded verbatim.
  coversUntil: string | null;
}

// Load a conversation's history already compressed if possible. Returns the
// summary plus the recent verbatim messages. If the conversation is short
// enough, summary is null and recent = all turns.
export async function loadCompressedHistory(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  args: {
    conversationId: string;
    userId: string;
    limit?: number;
  },
): Promise<{
  summary: string | null;
  recent: { role: "user" | "assistant"; content: string }[];
}> {
  const convo = await supabase
    .from("conversations")
    .select("history_summary, history_summary_covers_until")
    .eq("id", args.conversationId)
    .maybeSingle();

  const summary = (convo.data?.history_summary ?? null) as string | null;
  const coversUntil = (convo.data?.history_summary_covers_until ?? null) as string | null;

  // Pull all messages, or all messages newer than the summary's coverage.
  let q = supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", args.conversationId)
    .eq("user_id", args.userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });
  if (coversUntil) q = q.gt("created_at", coversUntil);
  q = q.limit(args.limit ?? 60);
  const { data } = await q;
  const rows = (data ?? []) as MessageRow[];

  // If the conversation has grown past DISTILL_AT turns since last distillation,
  // kick off a background distill (fire-and-forget) so the next turn benefits.
  if (rows.length >= DISTILL_AT) {
    void distillConversation(supabase, anthropic, {
      conversationId: args.conversationId,
      userId: args.userId,
    }).catch(() => {});
  }

  return {
    summary,
    recent: rows.map((r) => ({ role: r.role, content: r.content })),
  };
}

const SUMMARY_SYSTEM =
  "Compress the following chat transcript into concise notes that preserve every fact, decision, task, or preference the user revealed. Omit pleasantries. Bullet points. Under 300 words.";

// Background op. Enqueues a distillation request into batch_queue so the
// Batch API cron can pick it up and save 50% on the summary call. The
// finisher (registered below) writes the resulting summary back onto
// conversations.history_summary when the batch completes.
//
// NOTE: the `anthropic` client is accepted but unused here — kept in the
// signature so call sites don't need to change, and so we can fall back to
// an inline call if batch enqueue fails.
export async function distillConversation(
  supabase: SupabaseClient,
  _anthropic: Anthropic,
  args: { conversationId: string; userId: string },
): Promise<void> {
  const { data } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", args.conversationId)
    .eq("user_id", args.userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(200);
  const rows = (data ?? []) as MessageRow[];
  if (rows.length < DISTILL_AT) return;

  const toCompress = rows.slice(0, rows.length - DISTILL_KEEP_RECENT);
  if (toCompress.length === 0) return;

  const coversUntil = toCompress[toCompress.length - 1]?.created_at;
  if (!coversUntil) return;

  const convo = await supabase
    .from("conversations")
    .select("history_summary, batch_distill_id")
    .eq("id", args.conversationId)
    .maybeSingle();
  // Don't double-enqueue while a previous distill is still in flight for
  // this conversation.
  if (convo.data?.batch_distill_id) return;
  const prior = (convo.data?.history_summary ?? "") as string;

  const transcript = toCompress
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`)
    .join("\n\n");

  const enqueued = await enqueueBatchRequest(supabase, {
    kind: "distill_conversation",
    userId: args.userId,
    params: { conversationId: args.conversationId, coversUntil },
    request: {
      model: SUMMARY_MODEL,
      max_tokens: SUMMARY_MAX_TOKENS,
      system: SUMMARY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${prior ? `Prior summary:\n${prior}\n\nNew transcript to merge in:\n` : ""}${transcript}`,
        },
      ],
    },
  });

  if (enqueued) {
    await supabase
      .from("conversations")
      .update({ batch_distill_id: enqueued.id })
      .eq("id", args.conversationId);
  }
}

registerFinisher("distill_conversation", async (supabase, row, resultText) => {
  const params = row.params as { conversationId?: string; coversUntil?: string };
  if (!params.conversationId || !params.coversUntil) return;
  await supabase
    .from("conversations")
    .update({
      history_summary: resultText,
      history_summary_covers_until: params.coversUntil,
      batch_distill_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId);
});
