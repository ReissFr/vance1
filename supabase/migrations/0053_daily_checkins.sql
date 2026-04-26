-- One-row-per-day check-in. Reiss can rate energy / mood / focus
-- 1-5 and drop a quick note. Lets the /checkins page show 30-day
-- sparklines and lets the brain answer "how's my energy been this week?".

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  energy smallint check (energy between 1 and 5),
  mood smallint check (mood between 1 and 5),
  focus smallint check (focus between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, log_date)
);

create index if not exists daily_checkins_user_date
  on public.daily_checkins(user_id, log_date desc);

alter table public.daily_checkins enable row level security;

create policy "daily_checkins_user_all"
  on public.daily_checkins
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
