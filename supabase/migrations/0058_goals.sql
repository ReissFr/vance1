-- 0058_goals.sql
-- Goals: longer-horizon objectives that sit above daily intentions and
-- aggregate wins. Milestones are stored inline as a jsonb array of
-- { text, done_at } objects so we don't need a join table for what is
-- almost always 3-7 items per goal.

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  why text,
  kind text not null default 'quarterly'
    check (kind in ('quarterly','monthly','yearly','custom')),
  target_date date,

  status text not null default 'active'
    check (status in ('active','done','dropped')),
  completed_at timestamptz,

  progress_pct smallint not null default 0
    check (progress_pct between 0 and 100),
  milestones jsonb not null default '[]'::jsonb,
  tags text[] default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goals_user_status_idx
  on public.goals (user_id, status, target_date);

alter table public.goals enable row level security;

create policy "goals_select_own" on public.goals
  for select using (auth.uid() = user_id);

create policy "goals_insert_own" on public.goals
  for insert with check (auth.uid() = user_id);

create policy "goals_update_own" on public.goals
  for update using (auth.uid() = user_id);

create policy "goals_delete_own" on public.goals
  for delete using (auth.uid() = user_id);
