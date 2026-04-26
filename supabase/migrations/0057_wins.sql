-- 0057_wins.sql
-- Wins log: a deliberately small place for the user to capture every shipped
-- thing, sale, milestone, or personal win. Solo founders chronically forget
-- their own progress; the evening wrap and weekly review surface this back.

create table if not exists public.wins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  text text not null,
  kind text not null default 'other'
    check (kind in ('shipped','sale','milestone','personal','other')),

  amount_cents bigint,
  related_to text,

  created_at timestamptz not null default now()
);

create index if not exists wins_user_created_idx
  on public.wins (user_id, created_at desc);

alter table public.wins enable row level security;

create policy "wins_select_own" on public.wins
  for select using (auth.uid() = user_id);

create policy "wins_insert_own" on public.wins
  for insert with check (auth.uid() = user_id);

create policy "wins_update_own" on public.wins
  for update using (auth.uid() = user_id);

create policy "wins_delete_own" on public.wins
  for delete using (auth.uid() = user_id);
