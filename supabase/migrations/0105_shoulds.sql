-- §166 The Should Ledger
-- Inventory of unmet self-mandates the user has typed.
-- Different from §156 promises (commitments to do) and §158 phantom_limbs (decisions
-- the user keeps redeciding) — these are unmet OBLIGATIONS the user feels they ought
-- to do, ought to be, ought to have done. The novel hook: obligation_source — naming
-- WHOSE voice the should is. Plus a release valve (status='released') so the user can
-- consciously let go of shoulds that aren't actually theirs to carry.

create table if not exists shoulds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  scan_id uuid not null,

  should_text text not null,
  should_kind text not null check (should_kind in (
    'moral',
    'practical',
    'social',
    'relational',
    'health',
    'identity',
    'work',
    'financial'
  )),

  distilled_obligation text not null,
  obligation_source text not null check (obligation_source in (
    'self',
    'parent',
    'partner',
    'inner_critic',
    'social_norm',
    'professional_norm',
    'financial_judge',
    'abstract_other'
  )),

  charge_score smallint not null check (charge_score between 1 and 5),
  domain text not null check (domain in (
    'work',
    'relationships',
    'health',
    'identity',
    'finance',
    'creative',
    'learning',
    'daily',
    'other'
  )),

  spoken_date date not null,
  spoken_message_id uuid,
  spoken_conversation_id uuid,

  recurrence_count int not null default 1,
  recurrence_days int not null default 1,
  recurrence_with_charge int not null default 0,
  recurrence_samples jsonb not null default '[]'::jsonb,

  pattern_severity smallint not null check (pattern_severity between 1 and 5),
  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending',
    'done',
    'released',
    'converted',
    'noted',
    'dismissed'
  )),
  status_note text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create index if not exists shoulds_user_recent_idx
  on shoulds (user_id, spoken_date desc);

create index if not exists shoulds_user_pending_severity_idx
  on shoulds (user_id, pattern_severity desc, spoken_date desc)
  where status = 'pending' and archived_at is null;

create index if not exists shoulds_user_kind_idx
  on shoulds (user_id, should_kind, spoken_date desc);

create index if not exists shoulds_user_charge_idx
  on shoulds (user_id, spoken_date desc)
  where charge_score >= 4;

create index if not exists shoulds_user_pinned_idx
  on shoulds (user_id, spoken_date desc)
  where pinned = true;

create index if not exists shoulds_scan_id_idx
  on shoulds (scan_id);

alter table shoulds enable row level security;

create policy "shoulds_select_own"
  on shoulds for select
  using (auth.uid() = user_id);

create policy "shoulds_insert_own"
  on shoulds for insert
  with check (auth.uid() = user_id);

create policy "shoulds_update_own"
  on shoulds for update
  using (auth.uid() = user_id);

create policy "shoulds_delete_own"
  on shoulds for delete
  using (auth.uid() = user_id);
