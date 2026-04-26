-- §169 The Threshold Ledger
-- Mines chats for moments where the user crossed an INTERNAL LINE — moments
-- where past-self would not have recognised present-self. Triggers like:
--   "I never thought I would..."
--   "I would never have..."
--   "First time I actually..."
--   "I used to think I couldn't..."
--   "Now I'm someone who..."
--   "Since when did I..."
--   "The old me would have..."
--
-- The temporal symmetry to §165 used_to: where used_to mourns lost selves,
-- thresholds mark NEW selves that emerged. Together they give the user a
-- before/after register of identity drift across time.
--
-- The novel hook: charge — was this crossing GROWTH (a line crossed in the
-- direction the user wanted) or DRIFT (a line crossed without consent, a
-- worrying compromise)? Naming the difference is the self-authorship move.
-- The user can INTEGRATE a crossing as identity evidence, DISPUTE the
-- framing, or DISMISS a false-positive.

create table if not exists thresholds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  scan_id uuid not null,

  threshold_text text not null,

  before_state text not null,
  after_state text not null,

  pivot_kind text not null check (pivot_kind in (
    'capability',
    'belief',
    'boundary',
    'habit',
    'identity',
    'aesthetic',
    'relational',
    'material'
  )),

  charge text not null check (charge in ('growth', 'drift', 'mixed')),
  magnitude smallint not null check (magnitude between 1 and 5),

  domain text not null check (domain in (
    'work', 'relationships', 'health', 'identity',
    'finance', 'creative', 'learning', 'daily', 'other'
  )),

  crossed_recency text not null check (crossed_recency in ('recent', 'older')),

  confidence smallint not null check (confidence between 1 and 5),

  spoken_date date not null,
  spoken_message_id text,
  conversation_id uuid,

  status text not null default 'active' check (status in (
    'active', 'integrated', 'dismissed', 'disputed'
  )),
  status_note text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists thresholds_user_msg_unique_idx
  on thresholds (user_id, spoken_message_id)
  where spoken_message_id is not null;

create index if not exists thresholds_user_recent_idx
  on thresholds (user_id, spoken_date desc, magnitude desc);

create index if not exists thresholds_user_active_idx
  on thresholds (user_id, magnitude desc, spoken_date desc)
  where status = 'active' and archived_at is null;

create index if not exists thresholds_user_kind_idx
  on thresholds (user_id, pivot_kind, spoken_date desc);

create index if not exists thresholds_user_charge_idx
  on thresholds (user_id, charge, magnitude desc);

create index if not exists thresholds_user_pinned_idx
  on thresholds (user_id, spoken_date desc)
  where pinned = true;

create index if not exists thresholds_scan_id_idx
  on thresholds (scan_id);

alter table thresholds enable row level security;

create policy "thresholds_select_own"
  on thresholds for select
  using (auth.uid() = user_id);

create policy "thresholds_insert_own"
  on thresholds for insert
  with check (auth.uid() = user_id);

create policy "thresholds_update_own"
  on thresholds for update
  using (auth.uid() = user_id);

create policy "thresholds_delete_own"
  on thresholds for delete
  using (auth.uid() = user_id);
