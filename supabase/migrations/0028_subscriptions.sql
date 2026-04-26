-- Subscription tracker. JARVIS scans the user's email (invoices, receipts,
-- renewal notices) and extracts recurring charges so it can answer
-- "what am I paying for?" and proactively flag trials ending / new subs.
--
-- One table. Detection state lives inline via first_seen_at / last_seen_at;
-- status drives the user-facing lifecycle (active | trial | cancelled).

create table if not exists public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,

  -- Canonical identity of the subscription. dedup_key is lower(service) plus
  -- amount + cadence, used to upsert on re-scan without duplicating rows.
  service_name        text not null,
  dedup_key           text not null,

  -- Money
  amount              numeric(10, 2),
  currency            text default 'GBP',
  cadence             text not null default 'unknown'
                      check (cadence in ('weekly','monthly','quarterly','annual','unknown')),

  -- Lifecycle
  status              text not null default 'active'
                      check (status in ('active','trial','cancelled','paused','unknown')),
  next_renewal_date   date,
  last_charged_at     timestamptz,
  category            text,

  -- Provenance — which email(s) did we spot this in, and how sure are we
  detection_source    text not null default 'email_scan',
  source_email_ids    jsonb not null default '[]'::jsonb,
  confidence          numeric(3, 2),

  -- User feedback loop
  user_confirmed      boolean not null default false,
  notes               text,

  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (user_id, dedup_key)
);

create index if not exists subscriptions_user_status_idx
  on public.subscriptions(user_id, status);

create index if not exists subscriptions_user_next_renewal_idx
  on public.subscriptions(user_id, next_renewal_date)
  where status in ('active','trial') and next_renewal_date is not null;

alter table public.subscriptions enable row level security;

create policy subscriptions_own_read
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

create policy subscriptions_own_update
  on public.subscriptions
  for update
  using (auth.uid() = user_id);

-- Tracks the last time we ran a full scan for this user, so the brain
-- doesn't trigger redundant 90-day sweeps. Separate from proactive_state
-- because cadence is different (scans are weekly-ish, proactive is hourly).
create table if not exists public.subscription_scan_state (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  last_scan_at        timestamptz,
  last_scan_email_id  text,
  subs_found          integer not null default 0,
  updated_at          timestamptz not null default now()
);

alter table public.subscription_scan_state enable row level security;

create policy subscription_scan_state_own_read
  on public.subscription_scan_state
  for select
  using (auth.uid() = user_id);
