-- routines: named ordered checklists for multi-step procedures.
-- Distinct from saved_prompts (single text template, no order), habits (binary
-- daily yes/no), and skills (executable code). Examples: "morning publish",
-- "pre-meeting prep", "post-launch checklist". The brain can fetch a routine
-- by name and run through the steps in conversation.

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  description text,
  steps text[] not null default '{}',
  tags text[] not null default '{}',

  use_count integer not null default 0,
  last_used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, name)
);

create index if not exists routines_user_used_idx
  on public.routines (user_id, last_used_at desc nulls last);

create index if not exists routines_user_name_idx
  on public.routines (user_id, name);

alter table public.routines enable row level security;

create policy "routines: select own"
  on public.routines for select
  using (auth.uid() = user_id);

create policy "routines: insert own"
  on public.routines for insert
  with check (auth.uid() = user_id);

create policy "routines: update own"
  on public.routines for update
  using (auth.uid() = user_id);

create policy "routines: delete own"
  on public.routines for delete
  using (auth.uid() = user_id);
