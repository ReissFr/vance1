-- Batch API queue. Anthropic's Message Batches API delivers a 50% discount
-- on input+output tokens but has up to 24h turnaround. Only safe for
-- non-realtime work: conversation distillation, scheduled summaries,
-- background analyses.
--
-- Flow:
--   1. Workers call enqueueBatchRequest() to append a row (status=queued).
--   2. A cron (/api/cron/batch-flush) groups queued rows by `kind`,
--      submits each group as one Anthropic batch, flips rows to submitted
--      with the batch_id + custom_id.
--   3. Same cron also polls submitted batches; when a batch ends it writes
--      per-request results back into the row and flips status=completed.
--   4. A kind-specific finisher (registered in code) reads completed rows
--      and applies the result (e.g. writes distilled summary to
--      conversations.history_summary).

create table if not exists public.batch_queue (
  id uuid primary key default gen_random_uuid(),

  -- Logical job type. Routes the result to the correct finisher. Examples:
  -- 'distill_conversation', 'briefing_summary', 'inbox_classify'.
  kind text not null,

  -- Which user this job belongs to. Null for cross-user jobs.
  user_id uuid references auth.users(id) on delete cascade,

  -- Arbitrary parameters the finisher needs to apply the result back into
  -- the app (e.g. { conversationId, priorSummary, coversUntil }).
  params jsonb not null default '{}'::jsonb,

  -- The request payload shipped to Anthropic (model, messages, system,
  -- max_tokens). Stored so a cron pass can build the batch without
  -- recomputing.
  request jsonb not null,

  -- Lifecycle: queued → submitted → completed (or failed/expired).
  status text not null default 'queued',

  -- Anthropic batch id, assigned when the batch is submitted.
  anthropic_batch_id text,

  -- The custom_id we used for this request inside the batch. Lets us match
  -- Anthropic results back to this row when the batch completes.
  custom_id text,

  -- Final assistant text. Null until the batch completes.
  result_text text,

  -- Captured error message if anything along the pipeline failed.
  error text,

  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz
);

create index if not exists batch_queue_status_kind_idx
  on public.batch_queue (status, kind, created_at);

create index if not exists batch_queue_batch_idx
  on public.batch_queue (anthropic_batch_id);

alter table public.batch_queue enable row level security;

-- Admin-only table. Users never read or write this directly — it's orchestrated
-- from cron + service-role workers. No public policies.

-- Track an in-flight distillation batch per conversation so we don't
-- double-enqueue while the previous one is still running.
alter table public.conversations
  add column if not exists batch_distill_id uuid references public.batch_queue(id) on delete set null;
