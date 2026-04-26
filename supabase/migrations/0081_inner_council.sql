-- inner_council_sessions + inner_council_voices: multi-voice
-- deliberation. The user asks one question, the system fans out N
-- parallel Haiku calls to different "voices of you" — each grounded
-- in a different slice of the user's actual data — and returns all
-- replies side by side.
--
-- Voices (each is a different system prompt + different evidence subset):
--   past_self_1y     — you from a year ago, conditioned on the 60d
--                      window ending 1y back (reflections / decisions /
--                      wins / intentions / standups / check-ins)
--   future_self_5y   — you 5 years ahead, conditioned on identity
--                      `becoming` / `aspire` claims + open goals +
--                      active themes
--   values_self      — the version of you that speaks only from your
--                      active `value` + `refuse` identity claims +
--                      current constitution articles
--   ambitious_self   — the part of you that speaks from open goals +
--                      active work/learning themes + stated trajectory
--   tired_self       — the part of you that's been writing low-energy
--                      check-ins, recurring blockers in standups, and
--                      the unanswered questions you keep parking
--   wise_self        — distilled from your reflection log, especially
--                      `lesson` + `regret` + `realisation` entries
--
-- The user gets to pick which voices speak (default: all six). Each
-- voice writes 2-4 short paragraphs in first person. After the council
-- speaks, the user can star a particular voice's reply, or write a
-- final synthesis note of their own.

create table if not exists public.inner_council_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  question text not null,
  synthesis_note text,

  pinned boolean not null default false,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inner_council_sessions_user_active_idx
  on public.inner_council_sessions (user_id, updated_at desc)
  where archived_at is null;

create index if not exists inner_council_sessions_user_pinned_idx
  on public.inner_council_sessions (user_id, updated_at desc)
  where pinned = true and archived_at is null;

alter table public.inner_council_sessions enable row level security;

create policy "inner_council_sessions: select own"
  on public.inner_council_sessions for select using (auth.uid() = user_id);
create policy "inner_council_sessions: insert own"
  on public.inner_council_sessions for insert with check (auth.uid() = user_id);
create policy "inner_council_sessions: update own"
  on public.inner_council_sessions for update using (auth.uid() = user_id);
create policy "inner_council_sessions: delete own"
  on public.inner_council_sessions for delete using (auth.uid() = user_id);


create table if not exists public.inner_council_voices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.inner_council_sessions(id) on delete cascade,

  voice text not null
    check (voice in (
      'past_self_1y','future_self_5y','values_self',
      'ambitious_self','tired_self','wise_self'
    )),

  content text not null,
  confidence smallint not null default 3 check (confidence between 1 and 5),
  starred boolean not null default false,

  -- What slices of data the voice was grounded in (for the UI footer
  -- and for auditability — never blind-trust a voice).
  source_kinds text[] not null default '{}',
  source_count smallint not null default 0,

  -- Latency for this voice's call, milliseconds.
  latency_ms integer,

  created_at timestamptz not null default now()
);

create index if not exists inner_council_voices_session_idx
  on public.inner_council_voices (session_id, voice);

alter table public.inner_council_voices enable row level security;

create policy "inner_council_voices: select own"
  on public.inner_council_voices for select using (auth.uid() = user_id);
create policy "inner_council_voices: insert own"
  on public.inner_council_voices for insert with check (auth.uid() = user_id);
create policy "inner_council_voices: update own"
  on public.inner_council_voices for update using (auth.uid() = user_id);
create policy "inner_council_voices: delete own"
  on public.inner_council_voices for delete using (auth.uid() = user_id);
