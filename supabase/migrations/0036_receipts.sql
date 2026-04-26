-- Receipts inbox. One-off purchase receipts extracted from email (Amazon,
-- Uber Eats, flight bookings, single-item shop orders). Companion to the
-- subscriptions table, which handles RECURRING charges; receipts handles
-- discrete purchases. Together they answer "what am I spending on".
--
-- Dedup key is lower(merchant) + amount + date — same email re-scanned or
-- cross-posted doesn't duplicate. source_email_ids is a jsonb list so we
-- can surface "the receipt came from: <subject / from>" in the UI.

create table if not exists public.receipts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,

  merchant            text not null,
  dedup_key           text not null,

  amount              numeric(10, 2),
  currency            text default 'GBP',

  purchased_at        timestamptz,
  category            text,

  description         text,
  order_ref           text,

  detection_source    text not null default 'email_scan',
  source_email_ids    jsonb not null default '[]'::jsonb,
  confidence          numeric(3, 2),

  user_confirmed      boolean not null default false,
  archived            boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (user_id, dedup_key)
);

create index if not exists receipts_user_time_idx
  on public.receipts(user_id, purchased_at desc);

create index if not exists receipts_user_active_idx
  on public.receipts(user_id)
  where archived = false;

alter table public.receipts enable row level security;

create policy receipts_own_read
  on public.receipts
  for select using (auth.uid() = user_id);

create policy receipts_own_update
  on public.receipts
  for update using (auth.uid() = user_id);
