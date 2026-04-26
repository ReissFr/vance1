-- observations: the brain's journal entries about the user. While the user
-- writes wins/reflections/standups/decisions, the brain reads across all of
-- them and writes back patterns it notices: contradictions, blind spots,
-- growth signals, encouragements, open questions worth thinking about.
--
-- This is not a chatbot reply — it's the brain talking to itself about you,
-- in the background, and surfacing what it's noticed. The user can dismiss
-- noisy observations or pin important ones.
--
-- Kinds:
--   pattern        — recurring theme noticed across entries
--   contradiction  — something said in one place clashes with another
--   blind_spot     — topic the user seems to be avoiding or under-weighting
--   growth         — visible improvement / momentum / shift over time
--   encouragement — affirming observation grounded in real entries
--   question       — open question the user hasn't faced yet
--
-- source_refs is a JSONB array of {kind, id, snippet} objects pointing back
-- to the entries the observation is grounded in. The UI links to them so
-- the observation is auditable, not vibes.

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null
    check (kind in (
      'pattern','contradiction','blind_spot','growth','encouragement','question'
    )),

  body text not null,
  confidence smallint not null default 3 check (confidence between 1 and 5),

  source_refs jsonb not null default '[]'::jsonb,
  window_days smallint not null default 30,

  pinned boolean not null default false,
  dismissed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists observations_user_active_idx
  on public.observations (user_id, dismissed_at, created_at desc);

create index if not exists observations_user_kind_idx
  on public.observations (user_id, kind, created_at desc)
  where dismissed_at is null;

create index if not exists observations_user_pinned_idx
  on public.observations (user_id, pinned, created_at desc)
  where pinned = true;

alter table public.observations enable row level security;

create policy "observations: select own"
  on public.observations for select
  using (auth.uid() = user_id);

create policy "observations: insert own"
  on public.observations for insert
  with check (auth.uid() = user_id);

create policy "observations: update own"
  on public.observations for update
  using (auth.uid() = user_id);

create policy "observations: delete own"
  on public.observations for delete
  using (auth.uid() = user_id);
