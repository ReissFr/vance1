-- Phase: Total Recall — unified searchable archive of the user's life.
--
-- Every email, chat turn, calendar event, WhatsApp message, meeting transcript,
-- and screen OCR snapshot lands here with a voyage embedding so the brain can
-- semantic-search "what did Tom say about pricing 3 months ago?" in one shot.
--
-- Dedupe key: (user_id, source, external_id) so repeated ingestion of the
-- same Gmail message / calendar event is idempotent.

create table if not exists public.recall_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  source       text not null check (source in ('email','chat','calendar','whatsapp','screen','meeting','note')),
  external_id  text,
  title        text,
  body         text not null,
  participants text[] default '{}',
  occurred_at  timestamptz not null,
  url          text,
  embedding    vector(1024),
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create unique index if not exists recall_events_dedupe_idx
  on public.recall_events(user_id, source, external_id)
  where external_id is not null;

create index if not exists recall_events_user_time_idx
  on public.recall_events(user_id, occurred_at desc);

create index if not exists recall_events_embedding_idx
  on public.recall_events using hnsw (embedding vector_cosine_ops);

create index if not exists recall_events_source_idx
  on public.recall_events(user_id, source, occurred_at desc);

-- RLS: users read their own events only. Writes go through the server
-- (service role).
alter table public.recall_events enable row level security;

create policy "users read own recall events"
  on public.recall_events for select
  using (auth.uid() = user_id);

-- Semantic search RPC. Optional source/since filters.
create or replace function public.match_recall_events(
  p_user_id      uuid,
  p_query_embedding vector(1024),
  p_match_count  integer default 12,
  p_sources      text[] default null,
  p_since        timestamptz default null
)
returns table (
  id           uuid,
  source       text,
  external_id  text,
  title        text,
  body         text,
  participants text[],
  occurred_at  timestamptz,
  url          text,
  metadata     jsonb,
  similarity   float
)
language sql
stable
as $$
  select
    e.id,
    e.source,
    e.external_id,
    e.title,
    e.body,
    e.participants,
    e.occurred_at,
    e.url,
    e.metadata,
    1 - (e.embedding <=> p_query_embedding) as similarity
  from public.recall_events e
  where e.user_id = p_user_id
    and (p_sources is null or e.source = any(p_sources))
    and (p_since is null or e.occurred_at >= p_since)
    and e.embedding is not null
  order by e.embedding <=> p_query_embedding
  limit greatest(1, p_match_count);
$$;

-- Cursor helper: remembers the most recent occurred_at per (user, source) so
-- incremental sync can pick up where the last run left off without a full
-- scan.
create table if not exists public.recall_cursors (
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null,
  last_synced_at timestamptz,
  last_external_id text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, source)
);

alter table public.recall_cursors enable row level security;

create policy "users read own recall cursors"
  on public.recall_cursors for select
  using (auth.uid() = user_id);
