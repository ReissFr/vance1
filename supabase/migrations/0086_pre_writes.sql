-- pre_writes: every draft JARVIS pre-fills for the user. Inverts the blank-
-- page problem — when the user opens a standup / reflection / intention /
-- win / check-in form, the brain has already drafted what they'd plausibly
-- write next based on their recent state, so they edit rather than start
-- from zero.
--
-- Each row logs the draft + the user's response (shown / accepted as-is /
-- edited / rejected / superseded by a new draft). Aggregating across many
-- drafts gives JARVIS a feedback loop: which kinds it predicts well, which
-- it doesn't, and the user's tone-match score. The accepted_id FK points at
-- the eventual reflection/standup/etc row when the user accepts.

create table if not exists public.pre_writes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('reflection','standup','intention','win','checkin')),
  subkind text,

  draft_body jsonb not null,
  source_summary text,
  source_counts jsonb not null default '{}'::jsonb,

  status text not null default 'shown'
    check (status in ('shown','accepted','edited','rejected','superseded')),
  accepted_id uuid,

  user_score smallint check (user_score between 1 and 5),
  user_note text,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists pre_writes_user_recent_idx
  on public.pre_writes (user_id, created_at desc);

create index if not exists pre_writes_user_kind_status_idx
  on public.pre_writes (user_id, kind, status);

create index if not exists pre_writes_user_accepted_idx
  on public.pre_writes (user_id, status, created_at desc)
  where status = 'accepted';

alter table public.pre_writes enable row level security;

create policy "pre_writes_select_own" on public.pre_writes
  for select using (auth.uid() = user_id);

create policy "pre_writes_insert_own" on public.pre_writes
  for insert with check (auth.uid() = user_id);

create policy "pre_writes_update_own" on public.pre_writes
  for update using (auth.uid() = user_id);

create policy "pre_writes_delete_own" on public.pre_writes
  for delete using (auth.uid() = user_id);
