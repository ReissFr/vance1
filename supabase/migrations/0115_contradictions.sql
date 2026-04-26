-- §176 — THE CONTRADICTIONS LEDGER.
--
-- Distinct from every utterance-extractor (§165–§175). Those tools mine
-- chat for utterances of a particular SHAPE — "I used to", "I should",
-- "I almost", "I'll", "I always". The contradictions ledger does
-- something different: it identifies PAIRS of statements across the
-- chat history that CONTRADICT each other. It's relational extraction,
-- not single-utterance extraction. The model is given a sample of
-- messages with dates and asked to find instances where the user said
-- one thing on one date and a contradicting thing on another.
--
-- The novel hook is DUAL — a resolution stance that refuses the
-- assumption that one of two contradicting statements must be wrong.
-- Some contradictions are genuine duality: "I'm a private person" AND
-- "I want to be known for my work" both hold, in different contexts,
-- without either being false. Naming that converts "I'm inconsistent"
-- into "I am multifaceted in this specific way", which is a different
-- and more honest stance.
--
-- Four resolutions:
--   evolved   — the later statement is now-true; the earlier was a
--               past self. The user has changed. Mark the era of the
--               older statement as historical.
--   dual      — both statements hold in different contexts / moods /
--               life-phases. Refuses the binary. The user says HOW each
--               one holds.
--   confused  — the user genuinely doesn't know which holds. The
--               contradiction is alive and unreconciled. Honoured as
--               such; bumped back to the queue.
--   rejected  — neither statement is current; the user has moved past
--               both. Names the actual current stance.
--
-- Plus dismissed (false positive from the scan), archived, pinned.
--
-- DAYS_APART is the secondary novel signal — surfaces how long a
-- contradiction has stood unreconciled. The longer the gap, the more
-- the user is forced to reckon with whether they've genuinely changed
-- or just told different stories at different times.

create table if not exists public.contradictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid,

  statement_a text not null check (char_length(statement_a) between 4 and 400),
  statement_a_date date not null,
  statement_a_msg_id text not null,

  statement_b text not null check (char_length(statement_b) between 4 and 400),
  statement_b_date date not null,
  statement_b_msg_id text not null,

  contradiction_kind text not null check (contradiction_kind in (
    'preference', 'belief', 'claim', 'commitment',
    'identity', 'value', 'desire', 'appraisal'
  )),

  topic text not null check (char_length(topic) between 4 and 120),

  domain text not null check (domain in (
    'work', 'health', 'relationships', 'family', 'finance',
    'creative', 'self', 'spiritual', 'other'
  )),

  charge smallint not null check (charge between 1 and 5),
  confidence smallint not null check (confidence between 1 and 5),
  days_apart int not null check (days_apart >= 0),

  status text not null default 'open' check (status in (
    'open', 'evolved', 'dual', 'confused', 'rejected', 'dismissed', 'archived'
  )),
  resolution_note text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same pair (a_msg + b_msg) shouldn't duplicate. Order-insensitive uniqueness
-- is enforced by ALWAYS storing (older_msg, newer_msg) at insert time.
create unique index if not exists contradictions_user_pair_uniq
  on public.contradictions (user_id, statement_a_msg_id, statement_b_msg_id);

create index if not exists contradictions_user_recent_idx
  on public.contradictions (user_id, statement_b_date desc, charge desc);

create index if not exists contradictions_user_open_idx
  on public.contradictions (user_id, charge desc, days_apart desc)
  where status = 'open' and archived_at is null;

create index if not exists contradictions_user_kind_idx
  on public.contradictions (user_id, contradiction_kind, statement_b_date desc);

create index if not exists contradictions_user_pinned_idx
  on public.contradictions (user_id, statement_b_date desc)
  where pinned = true;

create index if not exists contradictions_user_domain_idx
  on public.contradictions (user_id, domain, statement_b_date desc);

create index if not exists contradictions_scan_idx
  on public.contradictions (scan_id);

alter table public.contradictions enable row level security;

drop policy if exists contradictions_select_own on public.contradictions;
create policy contradictions_select_own on public.contradictions
  for select using (auth.uid() = user_id);

drop policy if exists contradictions_insert_own on public.contradictions;
create policy contradictions_insert_own on public.contradictions
  for insert with check (auth.uid() = user_id);

drop policy if exists contradictions_update_own on public.contradictions;
create policy contradictions_update_own on public.contradictions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists contradictions_delete_own on public.contradictions;
create policy contradictions_delete_own on public.contradictions
  for delete using (auth.uid() = user_id);

create or replace function public.touch_contradictions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists contradictions_touch_updated_at on public.contradictions;
create trigger contradictions_touch_updated_at
  before update on public.contradictions
  for each row execute function public.touch_contradictions_updated_at();
