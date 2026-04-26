-- reflections: a writable journal of lessons, regrets, realisations, observations,
-- gratitude — the "what did I learn" layer that compounds across weeks. Distinct
-- from ideas (prospective) and decisions (committed choices) — reflections are
-- retrospective synthesis.

create table if not exists public.reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  kind text not null default 'observation' check (kind in ('lesson','regret','realisation','observation','gratitude','other')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists reflections_user_created_idx
  on public.reflections (user_id, created_at desc);

alter table public.reflections enable row level security;

create policy "reflections: select own"
  on public.reflections for select
  using (auth.uid() = user_id);

create policy "reflections: insert own"
  on public.reflections for insert
  with check (auth.uid() = user_id);

create policy "reflections: update own"
  on public.reflections for update
  using (auth.uid() = user_id);

create policy "reflections: delete own"
  on public.reflections for delete
  using (auth.uid() = user_id);
