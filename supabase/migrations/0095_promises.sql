-- promises: self-promises mined from the user's own messages.
--
-- Premise: people notice broken promises to OTHERS. Almost no system
-- surfaces broken promises to SELF. The Promise Ledger is a
-- self-trust audit. It scans the user's chat history for "I will X",
-- "next week I'll Y", "starting tomorrow I'll Z", "I'm going to start
-- W", clusters by action, attaches the deadline if one was specified,
-- and lets the user mark each promise as KEPT / BROKEN / DEFERRED /
-- CANCELLED / UNCLEAR after its deadline passes.
--
-- This is NOT a TODO list. It's the inverse of one — a record of
-- commitments the user already made to themselves, surfaced so they
-- can see their own pattern. The most uncomfortable mirror in JARVIS.

create table if not exists public.promises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Groups all promises surfaced from one scan run.
  scan_id uuid not null,

  -- 3-8 word distillation of the action. "Cut the agency project",
  -- "Run three times this week", "Stop drinking on weekdays".
  action_summary text not null,

  -- The verbatim quote from the user's message. Receipts.
  original_quote text not null,

  -- Domain bucket.
  category text not null check (category in (
    'habit','decision','relationship','health','work',
    'creative','financial','identity','other'
  )),

  -- The deadline as the user spoke it: "tomorrow", "next week",
  -- "starting Monday", "by end of month", "in 3 months", or "open"
  -- if no deadline was specified.
  deadline_text text,

  -- Resolved absolute deadline date if computable from the message
  -- date + the deadline_text. NULL if open-ended or unparseable.
  deadline_date date,

  -- The date the promise was made (date of source message).
  promised_at date not null,

  -- Pointers back to the message the promise lives in.
  source_conversation_id uuid,
  source_message_id uuid,

  -- 1-5 commitment strength. 5 = "I am doing this, this is decided",
  -- 1 = "I should probably". The model rates linguistic force.
  strength smallint not null check (strength between 1 and 5),

  -- How many similar promises preceded this one in the scanned
  -- window. 0 = first time. Higher = the user keeps re-promising
  -- the same thing. This is the LOAD-BEARING signal — repeated
  -- self-promises are the kindest possible language for a broken
  -- pattern.
  repeat_count int not null default 0,

  -- Pointer to the most recent prior similar promise, if any.
  -- Lets the UI show "you also promised this on date X".
  prior_promise_id uuid references public.promises(id) on delete set null,

  -- User response state.
  status text not null default 'pending' check (status in (
    'pending','kept','broken','deferred','cancelled','unclear'
  )),
  status_note text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  -- Audit
  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create index if not exists promises_user_recent_idx
  on public.promises (user_id, created_at desc);

create index if not exists promises_user_pending_idx
  on public.promises (user_id, deadline_date asc, created_at desc)
  where status = 'pending' and archived_at is null;

create index if not exists promises_user_due_idx
  on public.promises (user_id, deadline_date)
  where status = 'pending' and archived_at is null and deadline_date is not null;

create index if not exists promises_user_status_idx
  on public.promises (user_id, status, created_at desc);

create index if not exists promises_user_pinned_idx
  on public.promises (user_id, created_at desc)
  where pinned = true and archived_at is null;

create index if not exists promises_user_category_idx
  on public.promises (user_id, category, created_at desc);

create index if not exists promises_scan_idx
  on public.promises (scan_id);

alter table public.promises enable row level security;

create policy "promises_select_own" on public.promises
  for select using (auth.uid() = user_id);

create policy "promises_insert_own" on public.promises
  for insert with check (auth.uid() = user_id);

create policy "promises_update_own" on public.promises
  for update using (auth.uid() = user_id);

create policy "promises_delete_own" on public.promises
  for delete using (auth.uid() = user_id);
