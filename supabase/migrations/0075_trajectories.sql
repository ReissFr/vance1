-- trajectories: projected future-state snapshots for the user. Each row
-- is ONE generation: a 6-month projection and a 12-month projection of
-- where the user is heading IF they continue at the current trajectory.
-- Grounded in their active goals, themes, predictions, policies, recent
-- wins, recent reflections — the brain extrapolates rather than fantasises.
--
-- Why a stored snapshot instead of always re-generating: trajectories
-- evolve as the user's life evolves. Storing each one lets the user (and
-- the brain) compare a projection from 30 days ago against today's reality
-- and notice drift, accelerating change, or stalled momentum.
--
-- key_drivers: the inputs the brain weighted most heavily this run
--   (e.g. "GoalLog: ship Jarvis SaaS by Sept", "Theme: cofounder-search active",
--   "Reflection trend: energy drop weeks 3-4")
-- assumptions: what would have to remain roughly true for the projection
--   to play out (e.g. "current SaaS traction continues", "no new health issue")
-- confidence: brain's honest 1-5 rating of how grounded the projection is
--   (1 = mostly speculation, 5 = strong evidence base)
-- pinned: user can pin a trajectory they want to keep visible
-- archived_at: soft-archive without losing the historical projection

create table if not exists public.trajectories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  body_6m text not null,
  body_12m text not null,

  key_drivers jsonb not null default '[]',
  assumptions jsonb not null default '[]',
  confidence smallint not null default 3 check (confidence between 1 and 5),

  source_counts jsonb not null default '{}',

  pinned boolean not null default false,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trajectories_user_active_idx
  on public.trajectories (user_id, created_at desc)
  where archived_at is null;

create index if not exists trajectories_user_pinned_idx
  on public.trajectories (user_id, created_at desc)
  where pinned = true and archived_at is null;

alter table public.trajectories enable row level security;

create policy "trajectories: select own"
  on public.trajectories for select
  using (auth.uid() = user_id);

create policy "trajectories: insert own"
  on public.trajectories for insert
  with check (auth.uid() = user_id);

create policy "trajectories: update own"
  on public.trajectories for update
  using (auth.uid() = user_id);

create policy "trajectories: delete own"
  on public.trajectories for delete
  using (auth.uid() = user_id);
