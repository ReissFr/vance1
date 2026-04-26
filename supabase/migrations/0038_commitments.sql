-- Commitments tracker. Pulls promises out of the user's email in BOTH
-- directions — things THEY promised others (outbound, risk of dropping the
-- ball) and things OTHERS promised them (inbound, risk of being ghosted).
--
-- Extracted by Haiku from email bodies during a sweep; dedup_key is
-- lower(other_party) + trimmed commitment_text, so re-scanning the same
-- thread doesn't duplicate.

create table if not exists public.commitments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,

  direction           text not null check (direction in ('outbound','inbound')),
  other_party         text not null,
  other_party_email   text,

  commitment_text     text not null,
  dedup_key           text not null,

  deadline            timestamptz,
  status              text not null default 'open'
                      check (status in ('open','done','overdue','cancelled')),

  source_email_id     text,
  source_email_subject text,
  confidence          numeric(3, 2),

  user_confirmed      boolean not null default false,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (user_id, dedup_key)
);

create index if not exists commitments_user_status_idx
  on public.commitments(user_id, status, deadline);

create index if not exists commitments_user_open_deadline_idx
  on public.commitments(user_id, deadline)
  where status = 'open';

alter table public.commitments enable row level security;

create policy commitments_own_read
  on public.commitments
  for select using (auth.uid() = user_id);

create policy commitments_own_update
  on public.commitments
  for update using (auth.uid() = user_id);

create policy commitments_own_delete
  on public.commitments
  for delete using (auth.uid() = user_id);
