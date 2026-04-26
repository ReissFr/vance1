-- Per-user browser machine routing. Maps each JARVIS user to the browser
-- backend they use (local / fly / browserbase) and, for cloud backends, the
-- machine identifier + CDP URL + persistent volume.
--
-- Single-tenant scaffold lives here without this table — FlyProvider falls
-- back to JARVIS_FLY_CDP_URL env. This table kicks in when we have >1 user
-- on cloud browsers and each one needs their own isolated profile.

create table if not exists public.browser_machines (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  provider    text        not null check (provider in ('local', 'fly', 'browserbase')),
  -- Provider-specific machine identifier (fly machine id, browserbase session
  -- id, etc.). Null for 'local' — the local provider keys on the host OS
  -- user's home dir instead.
  machine_id  text,
  -- Full CDP websocket URL for the machine (ws:// or wss://). Null for
  -- 'local' — local provider spawns its own Chromium and derives the port
  -- from DevToolsActivePort.
  cdp_url     text,
  -- Fly volume id (or equivalent) holding the Chromium user-data-dir. Lets
  -- us rehydrate the profile onto a new machine if the old one is lost.
  volume_id   text,
  -- Free-form provider metadata (region, VM size, anything else). Kept as
  -- jsonb so adding fields doesn't need a migration.
  meta        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.browser_machines enable row level security;

-- Users can only see/update their own row. Service role (brain + API routes
-- using supabase-admin) bypasses RLS — those are the writers.
create policy "browser_machines_own_select"
  on public.browser_machines
  for select
  using (auth.uid() = user_id);

create policy "browser_machines_own_update"
  on public.browser_machines
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
