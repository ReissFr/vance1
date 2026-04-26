-- saved_prompts: a library of reusable instructions the user can fire by name.
-- Distinct from skills (runnable code) and memories (passive context) — these
-- are command templates: "run my Friday recap prompt", "fire the cold-outreach
-- template", "draft using my investor-update boilerplate".

create table if not exists public.saved_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  body text not null,
  description text,
  tags text[] not null default '{}',

  use_count integer not null default 0,
  last_used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, name)
);

create index if not exists saved_prompts_user_used_idx
  on public.saved_prompts (user_id, last_used_at desc nulls last);

create index if not exists saved_prompts_user_name_idx
  on public.saved_prompts (user_id, name);

alter table public.saved_prompts enable row level security;

create policy "saved_prompts: select own"
  on public.saved_prompts for select
  using (auth.uid() = user_id);

create policy "saved_prompts: insert own"
  on public.saved_prompts for insert
  with check (auth.uid() = user_id);

create policy "saved_prompts: update own"
  on public.saved_prompts for update
  using (auth.uid() = user_id);

create policy "saved_prompts: delete own"
  on public.saved_prompts for delete
  using (auth.uid() = user_id);
