-- Phase 2 of the cost layer. Three more tables that each shave tokens or
-- inference calls off the hot path:
--
-- 1. embedding_cache — hash → vector memoisation. Any string embedded twice
--    (same user message, same skill intent, etc.) is a single API call.
--
-- 2. skill_failures — "approach X on site Y doesn't work" so JARVIS doesn't
--    waste Sonnet rediscovering dead ends. Cross-user but coarse-grained.
--
-- 3. conversations.history_summary — compressed memory of turns that have
--    fallen out of the live history window. Cuts input tokens per round on
--    long conversations by 50–80%.

-- ---------------------------------------------------------------------------
-- embedding_cache
-- ---------------------------------------------------------------------------

-- Global (not per-user) cache. Embeddings are deterministic functions of the
-- input text; no privacy risk in sharing them. We key by sha256 of the text
-- so we never store the text itself — hash collisions are astronomically
-- unlikely and even then only produce a stale vector, not a data leak.
create table if not exists public.embedding_cache (
  hash text primary key,
  embedding vector(1024) not null,
  model text not null default 'voyage-3',
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);

create index if not exists embedding_cache_last_hit_idx
  on public.embedding_cache (last_hit_at desc nulls last);

alter table public.embedding_cache enable row level security;

-- Reads allowed to any authenticated user (no PII in an embedding hash).
create policy embedding_cache_select_all
  on public.embedding_cache
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- skill_failures
-- ---------------------------------------------------------------------------

-- "This approach on this site / scope didn't work." Cross-user, coarse-
-- grained, expires. Checked BEFORE picking a skill to replay so we don't
-- waste inference on known dead ends.
create table if not exists public.skill_failures (
  id uuid primary key default gen_random_uuid(),

  -- Fingerprint of the user intent (same hash function used by learned_skills).
  fingerprint text not null,

  -- Site/scope the failure applies to. null = cross-site failure.
  site text,

  -- Short human-readable explanation of why it failed. Surfaced to the brain
  -- so it knows what NOT to do. "Polymarket blocks browser_type on the search
  -- box — use browser_click on the suggestion list instead."
  reason text not null,

  -- Reference to the skill that failed (if we were replaying one).
  skill_id uuid references public.learned_skills(id) on delete set null,

  -- Expires so a temporary site outage doesn't permanently kill an approach.
  expires_at timestamptz not null default (now() + interval '14 days'),

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists skill_failures_fingerprint_idx
  on public.skill_failures (fingerprint, site, expires_at desc);

create index if not exists skill_failures_expires_idx
  on public.skill_failures (expires_at);

alter table public.skill_failures enable row level security;

create policy skill_failures_select_active
  on public.skill_failures
  for select
  to authenticated
  using (expires_at > now());

-- ---------------------------------------------------------------------------
-- conversations.history_summary
-- ---------------------------------------------------------------------------

-- Compressed memo of old turns once a conversation exceeds the live history
-- window. Updated by a background distillation job; the brain prepends it
-- to the system prompt so old context is preserved at a fraction of the
-- token cost.
alter table public.conversations
  add column if not exists history_summary text,
  add column if not exists history_summary_covers_until timestamptz;

create index if not exists conversations_summary_covers_idx
  on public.conversations (id, history_summary_covers_until);
