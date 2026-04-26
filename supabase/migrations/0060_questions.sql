-- Open-question log. Founder questions that don't fit as ideas (which are
-- possibilities) or decisions (which are committed choices). A question seeks
-- new information; the brain can log them proactively in conversation and
-- close them with `answer_question` when the answer surfaces later.

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  kind text not null default 'other'
    check (kind in ('strategic','customer','technical','personal','other')),
  status text not null default 'open'
    check (status in ('open','exploring','answered','dropped')),
  priority smallint not null default 2
    check (priority between 1 and 3),
  answer text,
  answered_at timestamptz,
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists questions_user_status_idx
  on public.questions (user_id, status, priority, created_at desc);

alter table public.questions enable row level security;

create policy "questions: select own"
  on public.questions for select
  using (auth.uid() = user_id);

create policy "questions: insert own"
  on public.questions for insert
  with check (auth.uid() = user_id);

create policy "questions: update own"
  on public.questions for update
  using (auth.uid() = user_id);

create policy "questions: delete own"
  on public.questions for delete
  using (auth.uid() = user_id);
