-- §170 — The Almost-Register
--
-- Mirror of /thresholds (§169). Where thresholds catalogue identity-crossings
-- the user DID make, almosts catalogue the ones they ALMOST made and pulled
-- back from at the last second.
--
-- The novel diagnostic field is `regret_tilt`: relief vs regret vs mixed.
-- Same surface phrase ("I almost quit", "I almost replied") can mean
-- RELIEF (thank god I didn't — the brake was wisdom) or
-- REGRET (I wish I had — the brake was fear).
-- Naming the difference IS the move.
--
-- The novel resolution mode is `retried` — converts a past near-miss into a
-- present commitment. The user states what they're now committing to and
-- (optionally) the brain creates a downstream intention. This is what makes
-- the register active rather than archival.

create table if not exists public.almosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null default gen_random_uuid(),

  -- The named near-miss
  act_text text not null check (length(act_text) between 4 and 220),
  pulled_back_by text not null check (length(pulled_back_by) between 4 and 220),
  consequence_imagined text check (consequence_imagined is null or length(consequence_imagined) <= 300),

  kind text not null check (kind in (
    'reaching_out','saying_no','leaving','staying','starting','quitting',
    'spending','refusing','confronting','asking','confessing','other'
  )),
  domain text not null check (domain in (
    'work','health','relationships','family','finance','creative','self','spiritual','other'
  )),
  weight smallint not null check (weight between 1 and 5),
  recency text not null check (recency in ('recent','older')),

  -- The diagnostic field — relief means the brake was right, regret means it was wrong
  regret_tilt text not null check (regret_tilt in ('relief','regret','mixed')),

  confidence smallint not null check (confidence between 1 and 5),
  spoken_date date not null,
  spoken_message_id text,
  conversation_id uuid,

  -- Resolution
  status text not null check (status in ('active','honoured','mourned','retried','dismissed')) default 'active',
  status_note text,
  retry_intention_id uuid,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  -- Audit
  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique within user — prevents re-extraction on rescan (UPSERT preserves user resolutions)
create unique index if not exists almosts_user_msg_unique
  on public.almosts (user_id, spoken_message_id)
  where spoken_message_id is not null;

create index if not exists almosts_user_date
  on public.almosts (user_id, spoken_date desc, weight desc);

create index if not exists almosts_user_active
  on public.almosts (user_id, weight desc, spoken_date desc)
  where status = 'active' and archived_at is null;

create index if not exists almosts_user_kind_date
  on public.almosts (user_id, kind, spoken_date desc);

create index if not exists almosts_user_regret_tilt
  on public.almosts (user_id, regret_tilt, weight desc);

create index if not exists almosts_user_pinned
  on public.almosts (user_id, spoken_date desc)
  where pinned = true and archived_at is null;

create index if not exists almosts_scan
  on public.almosts (scan_id);

alter table public.almosts enable row level security;

create policy "almosts_select_own"
  on public.almosts for select
  using (auth.uid() = user_id);

create policy "almosts_insert_own"
  on public.almosts for insert
  with check (auth.uid() = user_id);

create policy "almosts_update_own"
  on public.almosts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "almosts_delete_own"
  on public.almosts for delete
  using (auth.uid() = user_id);
