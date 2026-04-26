-- knowledge_cards: atomic facts, quotes, principles, playbooks, stats the
-- user wants to reference later. Distinct from /reading (article queue),
-- /memory (passive user-facts), /reflections (own-life lessons). This is a
-- structured library of "what other people said worth remembering" that the
-- brain can search when writing, thinking, or arguing.

create table if not exists public.knowledge_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  claim text not null,
  source text,
  url text,
  kind text not null default 'other'
    check (kind in ('stat','quote','principle','playbook','anecdote','definition','other')),
  tags text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_cards_user_when_idx
  on public.knowledge_cards (user_id, created_at desc);

create index if not exists knowledge_cards_user_kind_idx
  on public.knowledge_cards (user_id, kind, created_at desc);

alter table public.knowledge_cards enable row level security;

create policy "knowledge_cards: select own"
  on public.knowledge_cards for select using (auth.uid() = user_id);
create policy "knowledge_cards: insert own"
  on public.knowledge_cards for insert with check (auth.uid() = user_id);
create policy "knowledge_cards: update own"
  on public.knowledge_cards for update using (auth.uid() = user_id);
create policy "knowledge_cards: delete own"
  on public.knowledge_cards for delete using (auth.uid() = user_id);
