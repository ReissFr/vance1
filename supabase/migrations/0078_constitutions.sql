-- constitutions: a versioned personal operating manual distilled from
-- the user's active policies, identity claims (especially value + refuse
-- kinds), recent decisions, active themes, and current trajectory.
--
-- Each row is a SNAPSHOT — running "regenerate" stamps a new row,
-- decrements the previous one's is_current flag, and links the new
-- version to its parent via parent_id. The user can read any past
-- version to see how their constitution has shifted over time.
--
-- Why this exists: most software stores values as a static profile
-- field set once at signup. A constitution is the user's own laws,
-- continuously re-written from their lived data, with each clause
-- citing the source it was distilled from. The brain is expected to
-- read the latest constitution BEFORE making any decision, draft, or
-- schedule on the user's behalf so it operates from the user's own
-- laws, not generic best-practice.
--
-- articles is the structured form: an array of
--   { id, title, body, kind, citations: [{kind, id, snippet}] }
-- where kind is one of: identity | value | refuse | how_i_work |
-- how_i_decide | what_im_building. The full body field is the
-- assembled markdown for display + brain reading.
--
-- source_counts records per-input-kind counts so the user can see
-- what the constitution was distilled from.

create table if not exists public.constitutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  version smallint not null default 1,
  parent_id uuid references public.constitutions(id) on delete set null,

  preamble text,
  body text not null,
  articles jsonb not null default '[]',

  source_counts jsonb not null default '{}',
  diff_summary text,

  is_current boolean not null default true,
  pinned boolean not null default false,
  archived_at timestamptz,

  user_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists constitutions_user_current_idx
  on public.constitutions (user_id, created_at desc)
  where is_current = true;

create index if not exists constitutions_user_recent_idx
  on public.constitutions (user_id, created_at desc);

create index if not exists constitutions_user_pinned_idx
  on public.constitutions (user_id, created_at desc)
  where pinned = true;

alter table public.constitutions enable row level security;

create policy "constitutions: select own"
  on public.constitutions for select
  using (auth.uid() = user_id);

create policy "constitutions: insert own"
  on public.constitutions for insert
  with check (auth.uid() = user_id);

create policy "constitutions: update own"
  on public.constitutions for update
  using (auth.uid() = user_id);

create policy "constitutions: delete own"
  on public.constitutions for delete
  using (auth.uid() = user_id);
