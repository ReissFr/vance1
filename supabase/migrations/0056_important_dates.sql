-- 0056_important_dates.sql
-- Birthdays and other recurring important dates. month+day repeat every year;
-- year is optional so JARVIS can compute age when present. lead_days is how
-- many days before the date the user wants a nudge.

create table if not exists public.important_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  date_type text not null default 'birthday'
    check (date_type in ('birthday','anniversary','custom')),

  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  year smallint,

  lead_days int not null default 7 check (lead_days between 0 and 60),
  last_notified_at date,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists important_dates_user_idx
  on public.important_dates (user_id, month, day);

alter table public.important_dates enable row level security;

create policy "important_dates_select_own" on public.important_dates
  for select using (auth.uid() = user_id);

create policy "important_dates_insert_own" on public.important_dates
  for insert with check (auth.uid() = user_id);

create policy "important_dates_update_own" on public.important_dates
  for update using (auth.uid() = user_id);

create policy "important_dates_delete_own" on public.important_dates
  for delete using (auth.uid() = user_id);
