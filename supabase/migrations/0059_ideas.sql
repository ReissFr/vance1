-- Idea inbox. Quick-capture for shower thoughts, possible ventures, content
-- angles, optimisations to try later. Heat = 1-5 self-rated excitement;
-- status moves fresh -> exploring -> adopted (or shelved).

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  kind text not null default 'other'
    check (kind in ('product','content','venture','optimization','other')),
  status text not null default 'fresh'
    check (status in ('fresh','exploring','shelved','adopted')),
  heat smallint not null default 3
    check (heat between 1 and 5),
  adopted_to text,
  note text,
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ideas_user_status_idx
  on public.ideas (user_id, status, created_at desc);

alter table public.ideas enable row level security;

create policy "ideas: select own"
  on public.ideas for select
  using (auth.uid() = user_id);

create policy "ideas: insert own"
  on public.ideas for insert
  with check (auth.uid() = user_id);

create policy "ideas: update own"
  on public.ideas for update
  using (auth.uid() = user_id);

create policy "ideas: delete own"
  on public.ideas for delete
  using (auth.uid() = user_id);
