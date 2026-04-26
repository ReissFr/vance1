-- standups: daily yesterday/today/blockers entry — one row per user per day,
-- enforced by unique(user_id, log_date). Distinct from intentions (single
-- focus) and wins (what shipped) — standups are structured self-
-- accountability the brain can pull when asking "what did you say you'd do
-- yesterday" or "what's been blocking you this week".

create table if not exists public.standups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  log_date date not null,
  yesterday text,
  today text,
  blockers text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, log_date)
);

create index if not exists standups_user_date_idx
  on public.standups (user_id, log_date desc);

alter table public.standups enable row level security;

create policy "standups: select own" on public.standups for select using (auth.uid() = user_id);
create policy "standups: insert own" on public.standups for insert with check (auth.uid() = user_id);
create policy "standups: update own" on public.standups for update using (auth.uid() = user_id);
create policy "standups: delete own" on public.standups for delete using (auth.uid() = user_id);
