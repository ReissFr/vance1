-- 0039_error_events.sql — self-hosted error log (complements Sentry if DSN set).
-- Every server-side route + worker can call reportError() to write here.

create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  route text,
  method text,
  message text not null,
  stack text,
  context jsonb,
  severity text not null default 'error' check (severity in ('error', 'warn', 'info')),
  sentry_forwarded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists error_events_created_idx
  on public.error_events (created_at desc);
create index if not exists error_events_user_idx
  on public.error_events (user_id, created_at desc);
create index if not exists error_events_route_idx
  on public.error_events (route, created_at desc);

alter table public.error_events enable row level security;

-- Only the user the error belongs to (or service role) can read it.
create policy error_events_own_read
  on public.error_events for select
  using (auth.uid() = user_id);
