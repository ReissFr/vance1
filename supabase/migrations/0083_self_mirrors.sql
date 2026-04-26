-- Self-Mirror Stream — auto-generated third-person paragraph describing
-- who the user APPEARS to be, based on the last N days of their own
-- writing. Generated on demand from the page or by a (future) daily/
-- weekly cron. Each mirror is a snapshot-in-time. With multiple snapshots
-- the user can scrub a timeline and literally see themselves drift,
-- grow, or loop.
--
-- The novel UX: not insights, not advice — a description. Short,
-- third-person, no moralising. The point is to give the user back the
-- view of themselves they already have, but compressed and dated, so
-- comparison-over-time becomes possible without re-reading the corpus.

create table if not exists public.self_mirrors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Description text — a single paragraph, ~120-220 words, third person.
  body text not null,

  -- Optional one-line drift note ("you've shifted from X to Y since the
  -- previous mirror"). Only populated when there's a previous mirror to
  -- compare against.
  drift_note text,

  -- Window the mirror was generated over.
  window_days smallint not null default 7,
  window_start date not null,
  window_end date not null,

  -- Counts of source rows that fed the generation, for transparency.
  source_counts jsonb not null default '{}'::jsonb,

  -- Optional comparison pointer to the previous mirror.
  parent_id uuid references public.self_mirrors(id) on delete set null,

  -- The user's own reaction to the mirror ("yes that's me" / "no that's
  -- not me at all" / freeform).
  user_note text,

  pinned boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists self_mirrors_user_recent_idx
  on public.self_mirrors (user_id, created_at desc);

create index if not exists self_mirrors_user_pinned_idx
  on public.self_mirrors (user_id, created_at desc)
  where pinned = true;

alter table public.self_mirrors enable row level security;

create policy self_mirrors_select_own on public.self_mirrors for select to authenticated using (auth.uid() = user_id);
create policy self_mirrors_insert_own on public.self_mirrors for insert to authenticated with check (auth.uid() = user_id);
create policy self_mirrors_update_own on public.self_mirrors for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy self_mirrors_delete_own on public.self_mirrors for delete to authenticated using (auth.uid() = user_id);

-- Opt-in flag for any future automated cron generation.
alter table public.profiles
  add column if not exists self_mirror_enabled boolean not null default false;

create index if not exists profiles_self_mirror_enabled_idx
  on public.profiles(self_mirror_enabled)
  where self_mirror_enabled = true;
