-- themes: narrative threads spanning weeks or months. Each theme is a story
-- arc the user wants JARVIS to keep tracking — "ending the agency", "Lisbon
-- move", "peptide research training", "ten-week strength block". Distinct
-- from goals (specific measurable outcome + target date) and decisions
-- (committed past choice). Themes have a mutable `current_state` field that
-- the brain updates as the story evolves, and an optional `outcome` filled
-- in when the theme closes.

create table if not exists public.themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  kind text not null default 'work'
    check (kind in ('work','personal','health','relationships','learning','creative','other')),
  status text not null default 'active'
    check (status in ('active','paused','closed')),

  description text,
  current_state text,
  outcome text,
  closed_at timestamptz,

  tags text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, title)
);

create index if not exists themes_user_status_idx
  on public.themes (user_id, status, updated_at desc);

create index if not exists themes_user_title_idx
  on public.themes (user_id, title);

alter table public.themes enable row level security;

create policy "themes: select own"
  on public.themes for select
  using (auth.uid() = user_id);

create policy "themes: insert own"
  on public.themes for insert
  with check (auth.uid() = user_id);

create policy "themes: update own"
  on public.themes for update
  using (auth.uid() = user_id);

create policy "themes: delete own"
  on public.themes for delete
  using (auth.uid() = user_id);
