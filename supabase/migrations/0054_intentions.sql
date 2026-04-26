-- One short intention per day. The morning counterpart to evening wrap:
-- a single sentence, completable, with carry-forward when missed.

create table if not exists public.intentions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  text text not null,
  completed_at timestamptz,
  carried_from uuid references public.intentions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, log_date)
);

create index if not exists intentions_user_date
  on public.intentions(user_id, log_date desc);

alter table public.intentions enable row level security;

create policy "intentions_user_all"
  on public.intentions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
