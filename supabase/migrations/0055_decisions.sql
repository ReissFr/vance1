-- 0055_decisions.sql
-- Decision log: a founder-grade record of decisions made — what was chosen,
-- what was rejected, what success looks like, and when to revisit it. Feeds
-- weekly-review prompts ("your decision X — has it played out?") and the
-- log_decision/list_decisions/review_decision brain tools.

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  context text,
  choice text not null,
  alternatives text,
  expected_outcome text,

  review_at date,
  reviewed_at timestamptz,
  outcome_note text,
  outcome_label text check (outcome_label in ('right_call','wrong_call','mixed','unclear')),

  tags text[] default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decisions_user_created_idx
  on public.decisions (user_id, created_at desc);

create index if not exists decisions_user_review_idx
  on public.decisions (user_id, review_at)
  where reviewed_at is null and review_at is not null;

alter table public.decisions enable row level security;

create policy "decisions_select_own" on public.decisions
  for select using (auth.uid() = user_id);

create policy "decisions_insert_own" on public.decisions
  for insert with check (auth.uid() = user_id);

create policy "decisions_update_own" on public.decisions
  for update using (auth.uid() = user_id);

create policy "decisions_delete_own" on public.decisions
  for delete using (auth.uid() = user_id);
