-- JARVIS core schema — Phase 1
-- Run order: enable extensions → tables → RLS → RPCs.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Application-level profile keyed to auth.users.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone     text default 'Europe/London',
  voice_id     text,
  model_tier_override text check (model_tier_override in ('haiku','sonnet','opus')),
  google_access_token  text,
  google_refresh_token text,
  google_token_expires_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Devices linked to a user (thin clients on each surface).
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('web','mac','ios','android')),
  label        text,
  push_token   text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists devices_user_idx on public.devices(user_id);

-- Conversations & messages.
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on public.conversations(user_id, updated_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system','tool')),
  content         text not null,
  tool_calls      jsonb,
  model_tier      text,
  input_tokens    integer,
  output_tokens   integer,
  cache_read_tokens integer,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);

-- Long-term memories with pgvector.
-- voyage-3 = 1024 dims; adjust if you change embedding model.
create table if not exists public.memories (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  kind              text not null check (kind in ('fact','preference','person','event','task')),
  content           text not null,
  embedding         vector(1024),
  source_message_id uuid references public.messages(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists memories_user_idx on public.memories(user_id);
create index if not exists memories_embedding_idx on public.memories
  using hnsw (embedding vector_cosine_ops);

-- Audit log of every tool call.
create table if not exists public.tool_runs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  tool_name  text not null,
  input      jsonb,
  output     jsonb,
  error      text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists tool_runs_user_idx on public.tool_runs(user_id, created_at desc);

-- Abuse / cost controls.
create table if not exists public.usage_counters (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null default current_date,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  voice_seconds integer not null default 0,
  primary key (user_id, day)
);

-- Row-level security: a user sees only their rows.
alter table public.profiles      enable row level security;
alter table public.devices       enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.memories      enable row level security;
alter table public.tool_runs     enable row level security;
alter table public.usage_counters enable row level security;

create policy profiles_owner      on public.profiles      for all using (auth.uid() = id) with check (auth.uid() = id);
create policy devices_owner       on public.devices       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy conversations_owner on public.conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy messages_owner      on public.messages      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy memories_owner      on public.memories      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tool_runs_owner     on public.tool_runs     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy usage_owner         on public.usage_counters for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create profile row on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Semantic memory search RPC. Called from the agent with the current turn's embedding.
create or replace function public.match_memories(
  p_user_id uuid,
  p_query_embedding vector(1024),
  p_match_count int default 6
) returns table (
  id uuid,
  user_id uuid,
  kind text,
  content text,
  source_message_id uuid,
  created_at timestamptz,
  similarity float
) language sql stable security invoker as $$
  select m.id, m.user_id, m.kind, m.content, m.source_message_id, m.created_at,
         1 - (m.embedding <=> p_query_embedding) as similarity
  from public.memories m
  where m.user_id = p_user_id
  order by m.embedding <=> p_query_embedding
  limit p_match_count;
$$;
