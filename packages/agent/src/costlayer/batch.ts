import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Batch API helper. Anthropic's Message Batches API discounts input+output
// tokens by 50% but has up to 24h turnaround. We queue non-realtime jobs
// into public.batch_queue and a cron flushes them:
//
//   flushPending(kind)  → picks up queued rows of a given kind, bundles
//                         them into one Anthropic batch, marks submitted.
//
//   reapCompleted()     → scans submitted rows, polls Anthropic for each
//                         batch, writes result_text back when the batch
//                         ends, flips status=completed (or failed).
//
// Finishers (kind → handler) are registered in code so the cron can apply
// completed results back into the app (e.g. writing a distilled summary
// onto conversations.history_summary). Register with registerFinisher().

export type BatchKind =
  | "distill_conversation"
  | "briefing_summary"
  | "autotitle"
  | (string & {});

const MAX_PER_BATCH = 100;
const POLL_STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h

// Enqueue a single request. Returns the row id so the caller can later look
// up the result (polling the row) if needed. Most callers fire-and-forget.
export async function enqueueBatchRequest(
  supabase: SupabaseClient,
  args: {
    kind: BatchKind;
    userId?: string | null;
    params?: Record<string, unknown>;
    request: Anthropic.Messages.MessageCreateParamsNonStreaming;
  },
): Promise<{ id: string; customId: string } | null> {
  const customId = `${args.kind}_${randomUUID()}`.slice(0, 64);
  const { data, error } = await supabase
    .from("batch_queue")
    .insert({
      kind: args.kind,
      user_id: args.userId ?? null,
      params: args.params ?? {},
      request: args.request as unknown as Record<string, unknown>,
      status: "queued",
      custom_id: customId,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id as string, customId };
}

// Pull up to MAX_PER_BATCH queued rows of the given kind, submit them as
// one Anthropic batch, flip rows to submitted. Returns the batch id.
export async function flushPending(
  supabase: SupabaseClient,
  anthropic: Anthropic,
  kind: BatchKind,
): Promise<{ batchId: string | null; submitted: number }> {
  const { data: rows } = await supabase
    .from("batch_queue")
    .select("id, custom_id, request")
    .eq("kind", kind)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_PER_BATCH);
  const pending = (rows ?? []) as Array<{
    id: string;
    custom_id: string;
    request: Anthropic.Messages.MessageCreateParamsNonStreaming;
  }>;
  if (pending.length === 0) return { batchId: null, submitted: 0 };

  const batch = await anthropic.messages.batches.create({
    requests: pending.map((r) => ({
      custom_id: r.custom_id,
      params: r.request,
    })),
  });

  await supabase
    .from("batch_queue")
    .update({
      status: "submitted",
      anthropic_batch_id: batch.id,
      submitted_at: new Date().toISOString(),
    })
    .in(
      "id",
      pending.map((r) => r.id),
    );

  return { batchId: batch.id, submitted: pending.length };
}

// Register a finisher that applies a completed result back into the app.
// Keyed by `kind` — cron looks up the finisher when a row completes and
// calls it with (supabase, row, resultText).
type Finisher = (
  supabase: SupabaseClient,
  row: BatchQueueRow,
  resultText: string,
) => Promise<void>;

interface BatchQueueRow {
  id: string;
  kind: string;
  user_id: string | null;
  params: Record<string, unknown>;
  custom_id: string;
  anthropic_batch_id: string;
  result_text: string | null;
}

const FINISHERS = new Map<string, Finisher>();

export function registerFinisher(kind: BatchKind, fn: Finisher): void {
  FINISHERS.set(kind, fn);
}

// Poll Anthropic for every batch that still has submitted rows. When a
// batch ends, fetch its results, write per-row result_text, run the
// kind-specific finisher, flip status=completed (or failed).
export async function reapCompleted(
  supabase: SupabaseClient,
  anthropic: Anthropic,
): Promise<{ completed: number; failed: number }> {
  const { data: rows } = await supabase
    .from("batch_queue")
    .select("anthropic_batch_id")
    .eq("status", "submitted")
    .not("anthropic_batch_id", "is", null);
  const batchIds = Array.from(
    new Set((rows ?? []).map((r) => r.anthropic_batch_id as string)),
  );
  if (batchIds.length === 0) return { completed: 0, failed: 0 };

  let completed = 0;
  let failed = 0;

  for (const batchId of batchIds) {
    try {
      const batch = await anthropic.messages.batches.retrieve(batchId);
      if (batch.processing_status !== "ended") continue;

      const { data: batchRows } = await supabase
        .from("batch_queue")
        .select("id, kind, user_id, params, custom_id, anthropic_batch_id, result_text")
        .eq("anthropic_batch_id", batchId)
        .eq("status", "submitted");
      const rowsByCustomId = new Map<string, BatchQueueRow>();
      for (const r of (batchRows ?? []) as BatchQueueRow[]) {
        rowsByCustomId.set(r.custom_id, r);
      }

      const resultStream = await anthropic.messages.batches.results(batchId);
      for await (const item of resultStream) {
        const row = rowsByCustomId.get(item.custom_id);
        if (!row) continue;

        if (item.result.type === "succeeded") {
          const message = item.result.message;
          const block = message.content.find((b) => b.type === "text");
          const text = block && block.type === "text" ? block.text.trim() : "";
          await supabase
            .from("batch_queue")
            .update({
              status: "completed",
              result_text: text,
              completed_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          completed += 1;

          const finisher = FINISHERS.get(row.kind);
          if (finisher && text) {
            await finisher(supabase, row, text).catch((e) => {
              console.error(`[batch] finisher ${row.kind} failed:`, e);
            });
          }
        } else {
          // errored / expired / canceled
          const reason = item.result.type;
          await supabase
            .from("batch_queue")
            .update({
              status: "failed",
              error: reason,
              completed_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          failed += 1;
        }
      }
    } catch (e) {
      console.error(`[batch] failed to reap ${batchId}:`, e);
    }
  }

  // Stale fallback: mark anything submitted >24h ago as expired so it
  // doesn't clog the queue if Anthropic never returns.
  await supabase
    .from("batch_queue")
    .update({ status: "failed", error: "stale submission" })
    .eq("status", "submitted")
    .lt("submitted_at", new Date(Date.now() - POLL_STALE_AFTER_MS).toISOString());

  return { completed, failed };
}
