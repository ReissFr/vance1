-- Habits tracker. Simple daily-or-weekly habit with a per-day check-in log.
-- Streaks + weekly completion are computed client-side from habit_logs rows.

create table if not exists public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  cadence     text not null default 'daily'
              check (cadence in ('daily', 'weekly')),
  -- For weekly habits: how many times per week is the goal (e.g. gym 3x/wk).
  target_per_week smallint not null default 7
                  check (target_per_week between 1 and 7),
  archived_at timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists habits_user_active_idx
  on public.habits(user_id, sort_order)
  where archived_at is null;

create table if not exists public.habit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  habit_id   uuid not null references public.habits(id) on delete cascade,
  -- Day the habit was marked done (local-date resolution; we store as DATE
  -- so duplicate check-ins on the same day collapse).
  log_date   date not null,
  created_at timestamptz not null default now(),
  unique (user_id, habit_id, log_date)
);

create index if not exists habit_logs_habit_date_idx
  on public.habit_logs(habit_id, log_date desc);

create index if not exists habit_logs_user_date_idx
  on public.habit_logs(user_id, log_date desc);

alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;

create policy habits_own_all
  on public.habits
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy habit_logs_own_all
  on public.habit_logs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
