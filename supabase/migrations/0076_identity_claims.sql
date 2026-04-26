-- identity_claims: the user's stated and revealed identity, extracted
-- from their own writing (reflections, decisions, themes, intentions,
-- wins). Each claim is a structured "I am / I value / I refuse / I'm
-- becoming / I aspire to" statement that the brain has spotted in the
-- user's words across time.
--
-- The deduplicating key is `normalized_key` — a stopword-filtered,
-- lowercase signature of the statement. Re-running extraction merges
-- into existing rows: bumps `occurrences`, updates `last_seen_at`,
-- appends `source_refs`. This means an identity claim the user keeps
-- voicing accumulates evidence; one they stop voicing slowly becomes
-- dormant.
--
-- Why this matters: the user can SEE their identity over time. They can
-- pin claims they want to anchor to ("I am a builder"). They can spot
-- dormant claims ("I value writing daily" — but you haven't said that
-- in 4 months, is that still you?). They can flag contradictions
-- (status=contradicted) when current behaviour clashes with a stated
-- value. Combined with §136 trajectories, the user has a current-self
-- snapshot AND a future-self projection grounded in real evidence.
--
-- kind enum:
--   am          → identity statement ("I am a builder", "I am east-London")
--   value       → stated value ("I value depth over breadth")
--   refuse      → hard line ("I refuse to take meetings before 11")
--   becoming    → in-flight identity shift ("I'm becoming someone who ships")
--   aspire      → forward-looking want ("I want to be the kind of person who…")
--
-- status enum:
--   active        → recent and consistent (last_seen_at within 60 days)
--   dormant       → no recent evidence (last_seen_at > 60 days, but never
--                   contradicted) — was this still you?
--   contradicted  → user behaviour clashes with this claim
--   retired       → user explicitly retired this claim ("not me anymore")

create table if not exists public.identity_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('am','value','refuse','becoming','aspire')),
  statement text not null,
  normalized_key text not null,

  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  source_refs jsonb not null default '[]',

  status text not null default 'active'
    check (status in ('active','dormant','contradicted','retired')),

  contradiction_note text,
  user_note text,
  pinned boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists identity_claims_user_key_uniq
  on public.identity_claims (user_id, normalized_key);

create index if not exists identity_claims_user_kind_status_idx
  on public.identity_claims (user_id, kind, status, last_seen_at desc);

create index if not exists identity_claims_user_pinned_idx
  on public.identity_claims (user_id, last_seen_at desc)
  where pinned = true;

alter table public.identity_claims enable row level security;

create policy "identity_claims: select own"
  on public.identity_claims for select
  using (auth.uid() = user_id);

create policy "identity_claims: insert own"
  on public.identity_claims for insert
  with check (auth.uid() = user_id);

create policy "identity_claims: update own"
  on public.identity_claims for update
  using (auth.uid() = user_id);

create policy "identity_claims: delete own"
  on public.identity_claims for delete
  using (auth.uid() = user_id);
