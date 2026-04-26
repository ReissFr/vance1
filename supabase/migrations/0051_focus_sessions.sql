-- Records each focus/deep-work block started from /focus so we can show
-- weekly stats and let the brain answer "how much deep work did I do this week?".

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_seconds integer not null,
  actual_seconds integer,
  topic text,
  completed_fully boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists focus_sessions_user_started
  on public.focus_sessions(user_id, started_at desc);

alter table public.focus_sessions enable row level security;

create policy "focus_sessions_user_all"
  on public.focus_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
