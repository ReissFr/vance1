-- latent_decisions: decisions the user MADE BY DEFAULT but never logged.
-- These are choices the user's actions reveal — stopped seeing X, dropped
-- a habit, abandoned a side-project, stopped going to a place — but which
-- never landed in the explicit decisions table because they happened
-- through drift, not through a moment of choice.
--
-- A scan compares two windows of evidence (older vs newer) across
-- people interactions, habit logs, theme activity, recent reflection
-- topics, and asks the model to surface latent decisions in the
-- user's own voice ("you've decided to stop running"). The user can
-- ACKNOWLEDGE (yes that's true), CONTEST (no, here's what's actually
-- happening), or DISMISS (this isn't a real signal). Acknowledging
-- can optionally materialise a real decisions row so the loop closes.

create table if not exists public.latent_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  scan_id uuid not null,

  kind text not null check (kind in ('person','theme','habit','routine','topic','practice','place','identity','other')),
  label text not null,
  candidate_decision text not null,
  evidence_summary text,
  evidence_old jsonb not null default '[]'::jsonb,
  evidence_new jsonb not null default '[]'::jsonb,
  strength smallint not null check (strength between 1 and 5),
  source_signal text,

  user_status text check (user_status in ('acknowledged','contested','dismissed')),
  user_note text,
  resulting_decision_id uuid references public.decisions(id) on delete set null,

  pinned boolean not null default false,
  archived_at timestamptz,
  resolved_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create index if not exists latent_decisions_user_recent_idx
  on public.latent_decisions (user_id, created_at desc);

create index if not exists latent_decisions_user_open_idx
  on public.latent_decisions (user_id, created_at desc)
  where user_status is null and archived_at is null;

create index if not exists latent_decisions_scan_idx
  on public.latent_decisions (scan_id);

create index if not exists latent_decisions_user_pinned_idx
  on public.latent_decisions (user_id, created_at desc)
  where pinned = true and archived_at is null;

alter table public.latent_decisions enable row level security;

create policy "latent_decisions_select_own" on public.latent_decisions
  for select using (auth.uid() = user_id);

create policy "latent_decisions_insert_own" on public.latent_decisions
  for insert with check (auth.uid() = user_id);

create policy "latent_decisions_update_own" on public.latent_decisions
  for update using (auth.uid() = user_id);

create policy "latent_decisions_delete_own" on public.latent_decisions
  for delete using (auth.uid() = user_id);
