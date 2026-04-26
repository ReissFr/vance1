-- Weekly digest tracking. weekly_digests is a per-user idempotency log so
-- duplicate cron fires on the same Sunday don't double-send. profiles gains
-- weekly_digest_enabled (default true so existing users opt in implicitly).

create table if not exists public.weekly_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  sent_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create index if not exists weekly_digests_user_idx
  on public.weekly_digests (user_id, week_start desc);

alter table public.weekly_digests enable row level security;

create policy "weekly_digests: select own"
  on public.weekly_digests for select
  using (auth.uid() = user_id);

alter table public.profiles
  add column if not exists weekly_digest_enabled boolean not null default true;
