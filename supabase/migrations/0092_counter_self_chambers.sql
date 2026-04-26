-- counter_self_chambers: the strongest possible adversary, voiced
-- against a position the user holds.
--
-- The user holds explicit decisions, identity claims, theme stances,
-- recent reflection conclusions, policies. Most apps store and surface
-- these. None attack them with the sharpest possible counter-argument.
-- Counter-Self Chamber lets the user pick a position and instantiate
-- a CHALLENGER from one of five voices (smart_cynic / concerned_mentor
-- / failure_timeline_self / external_skeptic / peer_been_there) who
-- writes the strongest argument against it. Each session also produces
-- 0-3 falsifiable predictions the position would entail, so the user
-- can later check whether the position is holding up against
-- reality.
--
-- The user can ENGAGE (write a response/integration), DEFER (logged
-- but not yet ready), UPDATE_POSITION (the challenge changed my mind),
-- or DISMISS. Engagement is the point — nothing forces a yes/no, the
-- chamber is a thinking tool, not a court.

create table if not exists public.counter_self_chambers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  target_kind text not null check (target_kind in ('decision','identity_claim','theme','policy','reflection','generic')),
  target_id uuid,
  target_snapshot text not null,

  challenger_voice text not null check (challenger_voice in ('smart_cynic','concerned_mentor','failure_timeline_self','external_skeptic','peer_been_there')),

  argument_body text not null,
  strongest_counterpoint text,
  falsifiable_predictions jsonb not null default '[]'::jsonb,

  user_response text check (user_response in ('engaged','deferred','updated_position','dismissed')),
  user_response_body text,
  new_position_text text,

  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create index if not exists counter_self_chambers_user_recent_idx
  on public.counter_self_chambers (user_id, created_at desc);

create index if not exists counter_self_chambers_user_open_idx
  on public.counter_self_chambers (user_id, created_at desc)
  where user_response is null and archived_at is null;

create index if not exists counter_self_chambers_user_target_idx
  on public.counter_self_chambers (user_id, target_kind, target_id);

create index if not exists counter_self_chambers_user_pinned_idx
  on public.counter_self_chambers (user_id, created_at desc)
  where pinned = true and archived_at is null;

alter table public.counter_self_chambers enable row level security;

create policy "counter_self_chambers_select_own" on public.counter_self_chambers
  for select using (auth.uid() = user_id);

create policy "counter_self_chambers_insert_own" on public.counter_self_chambers
  for insert with check (auth.uid() = user_id);

create policy "counter_self_chambers_update_own" on public.counter_self_chambers
  for update using (auth.uid() = user_id);

create policy "counter_self_chambers_delete_own" on public.counter_self_chambers
  for delete using (auth.uid() = user_id);
