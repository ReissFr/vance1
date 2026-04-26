-- §174 — THE LOOPS REGISTER (recurring concerns index).
-- Where §165–§172 mine for individual utterances of certain shapes
-- (used-to / should / threshold / almost / imagined-future / vow), this
-- table mines for RECURRENCE — themes the user has returned to more
-- than once across different chats. The novel signal is the meta-pattern
-- OVER utterances, not the utterances themselves.
--
-- Each loop has time-weighted metrics: chronicity (how long the loop has
-- been live), velocity (escalating / stable / dampening / dormant — read
-- from how the recent occurrences compare to older ones), amplitude
-- (avg intensity per occurrence).
--
-- Four novel resolutions, refusing the typical "resolve everything" or
-- "let things accumulate forever" binaries:
--   break    — commit to something that ends the loop
--   widen    — introduce new information; the loop reframes
--   settle   — accept the loop as part of who you are (some loops are
--              ongoing care, not problems to solve — "missing my dad
--              isn't a problem to fix, it's the shape of love now")
--   archive  — the loop resolved on its own

create table if not exists public.loops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid,

  topic_text text not null check (length(topic_text) between 4 and 280),
  loop_kind text not null check (loop_kind in (
    'question',         -- "should I quit?"
    'fear',             -- "what if she leaves"
    'problem',          -- "the broken-ness of X"
    'fantasy',          -- recurring imagined scene that ISN'T a future-pull
    'scene_replay',     -- the conversation / moment played and re-played
    'grievance',        -- "what he did to me"
    'craving',          -- "I keep wanting X"
    'regret_gnaw',      -- "the thing I keep wishing I'd done"
    'other'
  )),
  domain text not null check (domain in (
    'work', 'health', 'relationships', 'family', 'finance',
    'creative', 'self', 'spiritual', 'other'
  )),

  -- recurrence metrics
  first_seen_date date not null,
  last_seen_date date not null,
  occurrence_count smallint not null check (occurrence_count >= 2),
  distinct_chat_count smallint not null check (distinct_chat_count >= 1),
  chronicity_days integer not null check (chronicity_days >= 0),
  amplitude smallint not null check (amplitude between 1 and 5),
  velocity text not null check (velocity in ('escalating', 'stable', 'dampening', 'dormant')),
  confidence smallint not null check (confidence between 1 and 5),

  -- evidence — IDs of representative messages that triggered the loop
  evidence_message_ids text[] default '{}',

  -- resolution
  status text not null default 'active' check (status in (
    'active', 'broken', 'widened', 'settled', 'archived', 'dismissed'
  )),
  status_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  -- audit
  latency_ms integer,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- partial unique on (user_id, topic_text) so rescans UPSERT rather than
-- duplicate when the model produces the same topic phrasing
create unique index if not exists loops_user_topic_unique
  on public.loops (user_id, topic_text);

create index if not exists loops_user_last_seen_idx
  on public.loops (user_id, last_seen_date desc, amplitude desc);
create index if not exists loops_user_active_idx
  on public.loops (user_id, status, amplitude desc, last_seen_date desc)
  where archived_at is null;
create index if not exists loops_user_kind_idx
  on public.loops (user_id, loop_kind, last_seen_date desc);
create index if not exists loops_user_velocity_idx
  on public.loops (user_id, velocity, amplitude desc);
create index if not exists loops_user_pinned_idx
  on public.loops (user_id, last_seen_date desc)
  where pinned = true;
create index if not exists loops_scan_id_idx
  on public.loops (scan_id);

alter table public.loops enable row level security;

create policy loops_select_own on public.loops
  for select using (auth.uid() = user_id);
create policy loops_insert_own on public.loops
  for insert with check (auth.uid() = user_id);
create policy loops_update_own on public.loops
  for update using (auth.uid() = user_id);
create policy loops_delete_own on public.loops
  for delete using (auth.uid() = user_id);

create or replace function public.touch_loops_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists loops_touch_updated_at on public.loops;
create trigger loops_touch_updated_at
  before update on public.loops
  for each row execute function public.touch_loops_updated_at();
