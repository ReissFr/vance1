-- Cost-reduction layer. Four tables that stack to make JARVIS cheaper the
-- more it's used:
--
-- 1. learned_skills — shared library of recorded tool-call trajectories.
--    First user to do a task pays Sonnet. Everyone else replays the cached
--    steps with Haiku. Sanitised (PII stripped) before sharing cross-user.
--
-- 2. skill_runs — every replay attempt, for promotion/deprecation.
--
-- 3. shared_learnings — cross-user facts about sites/services. "Polymarket's
--    signup modal dismisses on Escape". First user to discover this writes
--    it; future users get it in their prompt and avoid re-learning.
--
-- 4. result_cache — per-user semantic cache of reasoning outputs. Same
--    question within TTL → answer served from cache, zero AI cost.
--
-- All four are read on every turn; all four shrink the token + inference
-- bill. None leak private data across users.

-- ---------------------------------------------------------------------------
-- learned_skills
-- ---------------------------------------------------------------------------

create table if not exists public.learned_skills (
  id uuid primary key default gen_random_uuid(),

  -- Deterministic hash of the normalised intent. Used for exact-match fast
  -- path; the embedding below is the fuzzy-match fallback.
  fingerprint text not null,

  -- Human-readable name, e.g. "instagram:create_post".
  name text not null,

  -- The normalised intent text we hashed to get fingerprint. Kept for
  -- debugging and surfaced to the brain when proposing a replay.
  intent text not null,

  -- Semantic embedding of the intent for fuzzy lookup. "create instagram post"
  -- and "post a photo to instagram" hash to different fingerprints but map to
  -- the same skill via cosine similarity.
  intent_embedding vector(1024),

  -- Site/domain this skill applies to ("instagram.com", "polymarket.com").
  -- Null = device-local or cross-site skill.
  site text,

  -- Short natural-language description. Surfaced to the brain when offering
  -- this skill as a replay option.
  description text not null,

  -- The trajectory: ordered list of tool calls + their sanitised inputs.
  -- Structure is { version, steps: [{ tool, input, expected_hint }] }.
  -- expected_hint is a short phrase describing what the step should achieve,
  -- used by the replayer to verify each step succeeded before moving on.
  steps jsonb not null,

  -- Variables that must be provided at replay time, e.g. ["caption", "image_path"].
  -- The replayer fills {{caption}} etc. from the user's current task context.
  variables text[] not null default '{}',

  -- Lifecycle:
  --   unverified — only replayed by the user who recorded it.
  --   verified   — replayed cross-user after N successful replays by distinct users.
  --   deprecated — site structure changed, needs re-recording.
  --   flagged    — security/quality issue, do not use.
  status text not null default 'unverified' check (
    status in ('unverified', 'verified', 'deprecated', 'flagged')
  ),

  verified_count integer not null default 0,
  failed_count integer not null default 0,
  last_verified_at timestamptz,
  last_failed_at timestamptz,

  -- Provenance (who recorded the first successful run).
  created_by_user_id uuid references auth.users(id) on delete set null,

  -- Site/UI version — bumped when the skill gets re-recorded after a failure.
  version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learned_skills_fingerprint_idx
  on public.learned_skills (fingerprint, status, version desc);

create index if not exists learned_skills_site_idx
  on public.learned_skills (site, status);

create index if not exists learned_skills_intent_embedding_idx
  on public.learned_skills
  using hnsw (intent_embedding vector_cosine_ops);

-- Every skill replay attempt is logged so we can (a) promote skills from
-- unverified → verified once N distinct users have replayed them successfully
-- and (b) deprecate them quickly when they start failing.
create table if not exists public.skill_runs (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.learned_skills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  success boolean not null,
  failed_step integer,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists skill_runs_skill_idx
  on public.skill_runs (skill_id, success, created_at desc);

-- RLS: a skill is readable by any authenticated user once it's verified.
-- Unverified skills are readable only by their creator. Writes go through
-- a server-side path (service role); end-users never insert directly.
alter table public.learned_skills enable row level security;
alter table public.skill_runs enable row level security;

create policy learned_skills_select_verified
  on public.learned_skills
  for select
  to authenticated
  using (status = 'verified' or created_by_user_id = auth.uid());

create policy skill_runs_select_own
  on public.skill_runs
  for select
  to authenticated
  using (user_id = auth.uid());

-- Semantic skill lookup. Returns skills whose intent embedding is close to
-- the query embedding and whose status allows the caller to see them.
-- Callers that want cross-user skills pass p_include_unverified=false.
create or replace function public.match_skills(
  p_user_id uuid,
  p_query_embedding vector(1024),
  p_site text default null,
  p_match_count int default 5,
  p_min_similarity float default 0.72
) returns table (
  id uuid,
  fingerprint text,
  name text,
  intent text,
  site text,
  description text,
  steps jsonb,
  variables text[],
  status text,
  verified_count integer,
  failed_count integer,
  version integer,
  similarity float
) language sql stable security invoker as $$
  select s.id, s.fingerprint, s.name, s.intent, s.site, s.description, s.steps,
         s.variables, s.status, s.verified_count, s.failed_count, s.version,
         1 - (s.intent_embedding <=> p_query_embedding) as similarity
  from public.learned_skills s
  where s.intent_embedding is not null
    and s.status in ('verified', 'unverified')
    and (s.status = 'verified' or s.created_by_user_id = p_user_id)
    and (p_site is null or s.site = p_site or s.site is null)
    and 1 - (s.intent_embedding <=> p_query_embedding) >= p_min_similarity
  order by s.intent_embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- ---------------------------------------------------------------------------
-- shared_learnings
-- ---------------------------------------------------------------------------

create table if not exists public.shared_learnings (
  id uuid primary key default gen_random_uuid(),

  -- Scope the fact to a site/domain. "polymarket.com", "gmail", "stripe", etc.
  -- null = global learning (e.g. "always press Escape to dismiss modals").
  scope text,

  -- The fact itself, 1-2 sentences. "Polymarket shows a signup modal to
  -- anonymous visitors — dismiss with Escape before reading the page."
  fact text not null,

  -- Embedding of the fact for semantic retrieval when the prompt builder is
  -- deciding which facts to inject.
  fact_embedding vector(1024),

  -- Category helps the prompt builder pick which facts to inject.
  --   ui         — UI quirk
  --   auth       — auth / login flow
  --   rate_limit — rate or timing constraint
  --   selector   — reliable selector hint
  --   gotcha     — general warning
  category text not null default 'gotcha' check (
    category in ('ui', 'auth', 'rate_limit', 'selector', 'gotcha')
  ),

  created_by_user_id uuid references auth.users(id) on delete set null,
  upvotes integer not null default 0,
  downvotes integer not null default 0,
  status text not null default 'active' check (
    status in ('active', 'flagged', 'retired')
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_learnings_scope_idx
  on public.shared_learnings (scope, status, upvotes desc);

create index if not exists shared_learnings_embedding_idx
  on public.shared_learnings
  using hnsw (fact_embedding vector_cosine_ops);

alter table public.shared_learnings enable row level security;

create policy shared_learnings_select_active
  on public.shared_learnings
  for select
  to authenticated
  using (status = 'active');

-- Return top-N active learnings for a given scope, optionally semantically
-- ranked by how relevant they are to the current turn's intent.
create or replace function public.match_learnings(
  p_query_embedding vector(1024),
  p_scope text default null,
  p_match_count int default 5,
  p_min_similarity float default 0.60
) returns table (
  id uuid,
  scope text,
  fact text,
  category text,
  upvotes integer,
  similarity float
) language sql stable security invoker as $$
  select l.id, l.scope, l.fact, l.category, l.upvotes,
         case
           when l.fact_embedding is null then 0.0
           else 1 - (l.fact_embedding <=> p_query_embedding)
         end as similarity
  from public.shared_learnings l
  where l.status = 'active'
    and (p_scope is null or l.scope = p_scope or l.scope is null)
    and (l.fact_embedding is null or 1 - (l.fact_embedding <=> p_query_embedding) >= p_min_similarity)
  order by
    case when l.fact_embedding is null then 1 else 0 end,
    l.fact_embedding <=> p_query_embedding,
    l.upvotes desc
  limit p_match_count;
$$;

-- ---------------------------------------------------------------------------
-- result_cache
-- ---------------------------------------------------------------------------

-- Per-user semantic cache. Key is a hash of (normalised question + relevant
-- context). Value is the cached answer. TTL varies — "what's my revenue
-- today" = 5 min; "how tall is Mt Fuji" = indefinite.
create table if not exists public.result_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Deterministic hash of the request (question + data fingerprint).
  key text not null,

  -- Embedding of the normalised question, so near-misses like "revenue
  -- today" vs "how much did we make today" both hit the same entry.
  query_embedding vector(1024),

  -- The cached result (plain text from the brain's final turn).
  answer text not null,

  -- When this entry becomes stale.
  expires_at timestamptz not null,

  -- Category lets us evict aggressively for time-sensitive stuff.
  --   static  — indefinite (how tall is Mt Fuji)
  --   daily   — refreshes at midnight (today's weather)
  --   hourly  — short-lived (news headlines)
  --   minute  — very short (live prices, inbox counts)
  category text not null default 'static' check (
    category in ('static', 'daily', 'hourly', 'minute')
  ),

  hits integer not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists result_cache_user_key_idx
  on public.result_cache (user_id, key);

create index if not exists result_cache_expires_idx
  on public.result_cache (expires_at);

create index if not exists result_cache_embedding_idx
  on public.result_cache
  using hnsw (query_embedding vector_cosine_ops);

alter table public.result_cache enable row level security;

create policy result_cache_select_own
  on public.result_cache
  for select
  to authenticated
  using (user_id = auth.uid());

-- Semantic lookup: find a non-expired cache entry for this user whose query
-- embedding is close to the current query. Returns one row or none.
create or replace function public.match_result_cache(
  p_user_id uuid,
  p_query_embedding vector(1024),
  p_min_similarity float default 0.88
) returns table (
  id uuid,
  key text,
  answer text,
  category text,
  expires_at timestamptz,
  similarity float
) language sql stable security invoker as $$
  select c.id, c.key, c.answer, c.category, c.expires_at,
         1 - (c.query_embedding <=> p_query_embedding) as similarity
  from public.result_cache c
  where c.user_id = p_user_id
    and c.query_embedding is not null
    and c.expires_at > now()
    and 1 - (c.query_embedding <=> p_query_embedding) >= p_min_similarity
  order by c.query_embedding <=> p_query_embedding
  limit 1;
$$;
