-- life_timelines: a stitched, AI-detected NARRATIVE timeline of the
-- user's life-so-far, broken into chapters automatically inferred from
-- the user's reflections / decisions / wins / themes / standups. Each
-- chapter has a 3-6 word title, a 3-4 sentence narrative paragraph,
-- start/end dates, and pointers to the key decisions + wins + themes
-- that defined it.
--
-- This is NOT just a flat stream of dated entries. The model groups
-- the stream into natural chapters where themes shift, where major
-- decisions happen, where pivots occur — turning the journal into a
-- READABLE STORY.
--
-- Each timeline is a dated snapshot. Re-stitching produces a new row
-- whose drift_summary contrasts it with the previous (chapters can
-- merge / split / re-titlt as more writing accumulates).

create table if not exists public.life_timelines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  chapters jsonb not null,
  drift_summary text,
  source_summary text,
  source_counts jsonb not null default '{}'::jsonb,

  earliest_date date,
  latest_date date,

  parent_id uuid references public.life_timelines(id) on delete set null,
  pinned boolean not null default false,
  archived_at timestamptz,
  user_note text,

  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create index if not exists life_timelines_user_recent_idx
  on public.life_timelines (user_id, created_at desc);

create index if not exists life_timelines_user_pinned_idx
  on public.life_timelines (user_id, created_at desc)
  where pinned = true and archived_at is null;

alter table public.life_timelines enable row level security;

create policy "life_timelines_select_own" on public.life_timelines
  for select using (auth.uid() = user_id);

create policy "life_timelines_insert_own" on public.life_timelines
  for insert with check (auth.uid() = user_id);

create policy "life_timelines_update_own" on public.life_timelines
  for update using (auth.uid() = user_id);

create policy "life_timelines_delete_own" on public.life_timelines
  for delete using (auth.uid() = user_id);
