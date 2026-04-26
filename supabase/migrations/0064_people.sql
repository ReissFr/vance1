-- people + interactions: the writable CRM-lite layer. /contacts is read-only
-- (auto-derived profiles from Gmail/calendar/recall). /people is the journal:
-- the user explicitly curates who matters, tags relationships, and logs
-- interactions over time. The "haven't spoken to X in 60 days" surfaces
-- depend on this writable layer.

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  relation text not null default 'other'
    check (relation in ('friend','family','team','customer','prospect','investor','founder','mentor','vendor','press','other')),
  importance integer not null default 2 check (importance between 1 and 3),

  email text,
  phone text,
  company text,
  role text,
  notes text,
  tags text[] not null default '{}',

  last_interaction_at timestamptz,
  reconnect_every_days integer,

  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists people_user_relation_idx
  on public.people (user_id, relation, last_interaction_at desc nulls last);

create index if not exists people_user_name_idx
  on public.people (user_id, name);

create table if not exists public.person_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,

  kind text not null default 'other'
    check (kind in ('call','meeting','email','dm','whatsapp','sms','event','intro','other')),
  summary text not null,
  sentiment text check (sentiment in ('positive','neutral','negative')),

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists person_interactions_user_when_idx
  on public.person_interactions (user_id, occurred_at desc);

create index if not exists person_interactions_person_when_idx
  on public.person_interactions (person_id, occurred_at desc);

alter table public.people enable row level security;
alter table public.person_interactions enable row level security;

create policy "people: select own" on public.people for select using (auth.uid() = user_id);
create policy "people: insert own" on public.people for insert with check (auth.uid() = user_id);
create policy "people: update own" on public.people for update using (auth.uid() = user_id);
create policy "people: delete own" on public.people for delete using (auth.uid() = user_id);

create policy "person_interactions: select own"
  on public.person_interactions for select using (auth.uid() = user_id);
create policy "person_interactions: insert own"
  on public.person_interactions for insert with check (auth.uid() = user_id);
create policy "person_interactions: update own"
  on public.person_interactions for update using (auth.uid() = user_id);
create policy "person_interactions: delete own"
  on public.person_interactions for delete using (auth.uid() = user_id);
