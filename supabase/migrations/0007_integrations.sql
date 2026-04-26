-- Integrations: one row per connected third-party service per user.
-- Replaces the hardcoded profiles.google_* columns and generalizes to payment
-- providers (Stripe/Paddle), calendar providers, social, CRM, etc.
--
-- Design:
--   kind      = capability category (email, payment, calendar, social, crm, storage)
--   provider  = concrete backend (gmail, outlook, stripe, paddle, gcal, o365, ...)
--   credentials = jsonb bag — shape differs per provider
--   scopes    = array of OAuth scopes (or whatever the provider calls them)
--   active    = at most one active row per (user_id, kind) — that's the one the
--               resolver returns when an agent asks for e.g. the email provider.
--
-- Security: RLS locks rows to their owner. service_role (server-side code) can
-- read across users — we rely on explicit user_id filters in queries. Encrypting
-- credentials at rest is tech debt; tracked separately.

create table if not exists public.integrations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('email','payment','calendar','social','crm','storage')),
  provider     text not null,
  credentials  jsonb not null default '{}'::jsonb,
  scopes       text[],
  active       boolean not null default true,
  expires_at   timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, kind, provider)
);

-- At most one *active* row per (user, kind). If a user connects Outlook after
-- Gmail, the app should flip gmail.active=false when marking outlook.active=true.
create unique index if not exists integrations_one_active_per_kind
  on public.integrations(user_id, kind)
  where active;

create index if not exists integrations_user_idx
  on public.integrations(user_id);

alter table public.integrations enable row level security;

create policy integrations_owner on public.integrations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Backfill: migrate existing profiles.google_* tokens into integrations rows.
-- Keeps the profiles columns around for a release cycle in case we need to
-- roll back — drop them in a later migration once the cutover is confirmed.
insert into public.integrations (user_id, kind, provider, credentials, expires_at, active)
select
  p.id,
  'email',
  'gmail',
  jsonb_build_object(
    'access_token',  p.google_access_token,
    'refresh_token', p.google_refresh_token
  ),
  p.google_token_expires_at,
  true
from public.profiles p
where p.google_access_token is not null
   or p.google_refresh_token is not null
on conflict (user_id, kind, provider) do nothing;
