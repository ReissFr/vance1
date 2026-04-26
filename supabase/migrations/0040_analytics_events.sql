-- 0040_analytics_events.sql — self-hosted product analytics
-- (complements PostHog if POSTHOG_KEY set).

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id text,
  event text not null,
  path text,
  properties jsonb,
  session_id text,
  source text check (source in ('web', 'mac', 'iphone', 'whatsapp', 'server')),
  posthog_forwarded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_idx
  on public.analytics_events (created_at desc);
create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id, created_at desc);
create index if not exists analytics_events_event_idx
  on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_session_idx
  on public.analytics_events (session_id);

alter table public.analytics_events enable row level security;

create policy analytics_events_own_read
  on public.analytics_events for select
  using (auth.uid() = user_id);

-- Anyone authenticated can insert their own events; server writes via service role.
create policy analytics_events_own_insert
  on public.analytics_events for insert
  with check (auth.uid() = user_id or user_id is null);
