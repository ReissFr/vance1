-- §165 The Used-To Register
--
-- Each row is a moment the user typed an "I used to ___" statement —
-- a past-tense identity reference. Across time, these stack into a
-- structural inventory of LOST SELVES: hobbies, habits, capabilities,
-- relationships, places, identities, beliefs, roles, rituals.
--
-- Different from §158 phantom limbs (resolved-but-unfinished things)
-- and §159 pivots (fragile direction changes). Phantom limbs are
-- decisions the user made and abandoned mid-execution. Pivots are
-- direction changes still in motion. Used-To statements are a
-- distinct surface — explicit past-tense references to who the user
-- used to be, do, have, or believe. They are almost never followed
-- by an action. They quietly accumulate as a litany of selves the
-- user has stopped being.
--
-- The longing_score (1-5) captures whether the user delivered the
-- statement neutrally (1: factual past) → mildly reminisced (2) →
-- mildly longing (3) → clearly longing (4) → mourning (5). The score
-- is what makes the row a diagnostic finding rather than a neutral
-- biographical fact. recurrence_with_longing tracks chronic mourning.
--
-- The reclaim mechanic: status='reclaimed' + status_note records
-- what the user did to bring the lost self back (or scheduled to).
-- Status='grieved' is the explicit-mourning move (acknowledged loss
-- but not returning). status='let_go' is the conscious release.
-- noted/dismissed for catalogue/false-positive.
--
-- No software in any category mines past-tense identity references
-- as a structural inventory of lost selves. Therapy traditions know
-- about loss-of-self phenomenologically; nobody surfaces it from a
-- person's own typed words longitudinally with a per-kind recurrence
-- map and a per-row reclaim mechanic.

create table if not exists public.used_to (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  used_to_text text not null,                          -- verbatim "I used to ___" phrase ≤200 chars
  used_to_kind text not null check (used_to_kind in (
    'hobby','habit','capability','relationship','place','identity','belief','role','ritual'
  )),

  what_was text,                                       -- the lost self/thing distilled (≤320 chars) — "drawing every Sunday morning", "running at 6am", "being someone who replied within an hour"
  what_was_kind text check (what_was_kind in (
    'activity','practice','trait','person_or_bond','location','self_concept','assumption','responsibility','rhythm'
  )),

  longing_score smallint not null check (longing_score between 1 and 5),
  -- 1 = neutral fact, 2 = mild reminisce, 3 = mild longing, 4 = clear longing, 5 = mourning

  domain text not null check (domain in (
    'work','relationships','health','identity','finance','creative','learning','daily','other'
  )),
  spoken_date date not null,
  message_id uuid,
  conversation_id uuid,

  recurrence_count int not null default 1,             -- DISTINCT messages with same used-to shape across window
  recurrence_days int not null default 1,
  recurrence_with_longing int not null default 0,      -- recurrences that ALSO contained a longing word (miss/wish/those days/should have/I should/wish I still)
  recurrence_samples jsonb not null default '[]'::jsonb,  -- [{date, snippet}] up to 5 PRIOR samples

  pattern_severity smallint not null check (pattern_severity between 1 and 5),
  -- 5 = recurrence ≥10 with longing ≥4 — chronic mourning
  -- 4 = recurrence ≥6 with longing ≥2 — entrenched longing
  -- 3 = recurrence ≥3 with kind in (hobby, relationship, identity) — habitual mourning
  -- 2 = recurrence ≥3 mixed — emerging
  -- 1 = isolated reference

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending','reclaimed','grieved','let_go','noted','dismissed'
  )),
  -- reclaimed = user took action (or scheduled action) to bring the lost self back; status_note = what they did/will do
  -- grieved   = user explicitly named the loss; status_note = the grief sentence
  -- let_go    = user consciously released the lost self; status_note = the let-go reason
  -- noted     = acknowledged, no action
  -- dismissed = false positive
  status_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists used_to_user_recent_idx
  on public.used_to (user_id, spoken_date desc);
create index if not exists used_to_user_pending_severity_idx
  on public.used_to (user_id, pattern_severity desc, spoken_date desc)
  where status = 'pending' and archived_at is null;
create index if not exists used_to_user_kind_idx
  on public.used_to (user_id, used_to_kind, spoken_date desc);
create index if not exists used_to_user_longing_idx
  on public.used_to (user_id, longing_score desc, spoken_date desc)
  where status = 'pending' and archived_at is null;
create index if not exists used_to_user_pinned_idx
  on public.used_to (user_id, spoken_date desc) where pinned = true;
create index if not exists used_to_scan_idx
  on public.used_to (scan_id);

alter table public.used_to enable row level security;

drop policy if exists "used_to-select-own" on public.used_to;
drop policy if exists "used_to-insert-own" on public.used_to;
drop policy if exists "used_to-update-own" on public.used_to;
drop policy if exists "used_to-delete-own" on public.used_to;

create policy "used_to-select-own" on public.used_to
  for select using (auth.uid() = user_id);
create policy "used_to-insert-own" on public.used_to
  for insert with check (auth.uid() = user_id);
create policy "used_to-update-own" on public.used_to
  for update using (auth.uid() = user_id);
create policy "used_to-delete-own" on public.used_to
  for delete using (auth.uid() = user_id);
