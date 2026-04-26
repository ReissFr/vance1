-- §157 Inner Voice Atlas
--
-- Categorise the user's own self-talk by VOICE — the texture of the inner
-- monologue, not the topic. Where §155 (conversation_loops) maps recurring
-- questions and §156 (promises) maps commitments, this maps the WHO inside
-- the user that is speaking when they speak to themselves.
--
-- Voices: critic | dreamer | calculator | frightened | soldier | philosopher
--       | victim | coach | comedian | scholar
--
-- Each scan produces:
--   1 row in inner_voice_atlas_scans (the summary — dominant voices, counts,
--     atlas_narrative)
--   N rows in inner_voices (one per excerpt, with voice tag + gloss).

create table if not exists public.inner_voice_atlas_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  window_days int not null,
  total_utterances int not null default 0,
  dominant_voice text,
  second_voice text,
  voice_counts jsonb not null default '{}'::jsonb,
  atlas_narrative text,
  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists inner_voice_atlas_scans_user_recent_idx
  on public.inner_voice_atlas_scans (user_id, created_at desc);

alter table public.inner_voice_atlas_scans enable row level security;

drop policy if exists "inner_voice_atlas_scans-select-own" on public.inner_voice_atlas_scans;
drop policy if exists "inner_voice_atlas_scans-insert-own" on public.inner_voice_atlas_scans;
drop policy if exists "inner_voice_atlas_scans-update-own" on public.inner_voice_atlas_scans;
drop policy if exists "inner_voice_atlas_scans-delete-own" on public.inner_voice_atlas_scans;

create policy "inner_voice_atlas_scans-select-own" on public.inner_voice_atlas_scans
  for select using (auth.uid() = user_id);
create policy "inner_voice_atlas_scans-insert-own" on public.inner_voice_atlas_scans
  for insert with check (auth.uid() = user_id);
create policy "inner_voice_atlas_scans-update-own" on public.inner_voice_atlas_scans
  for update using (auth.uid() = user_id);
create policy "inner_voice_atlas_scans-delete-own" on public.inner_voice_atlas_scans
  for delete using (auth.uid() = user_id);

create table if not exists public.inner_voices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null references public.inner_voice_atlas_scans(id) on delete cascade,
  voice text not null check (voice in (
    'critic','dreamer','calculator','frightened','soldier',
    'philosopher','victim','coach','comedian','scholar'
  )),
  excerpt text not null,
  gloss text not null,
  intensity smallint not null check (intensity between 1 and 5),
  spoken_at date not null,
  source_conversation_id uuid,
  source_message_id uuid,
  pinned boolean not null default false,
  archived_at timestamptz,
  user_note text,
  created_at timestamptz not null default now()
);

create index if not exists inner_voices_user_recent_idx
  on public.inner_voices (user_id, created_at desc);
create index if not exists inner_voices_user_voice_recent_idx
  on public.inner_voices (user_id, voice, spoken_at desc);
create index if not exists inner_voices_user_pinned_idx
  on public.inner_voices (user_id, created_at desc) where pinned = true;
create index if not exists inner_voices_scan_idx
  on public.inner_voices (scan_id);

alter table public.inner_voices enable row level security;

drop policy if exists "inner_voices-select-own" on public.inner_voices;
drop policy if exists "inner_voices-insert-own" on public.inner_voices;
drop policy if exists "inner_voices-update-own" on public.inner_voices;
drop policy if exists "inner_voices-delete-own" on public.inner_voices;

create policy "inner_voices-select-own" on public.inner_voices
  for select using (auth.uid() = user_id);
create policy "inner_voices-insert-own" on public.inner_voices
  for insert with check (auth.uid() = user_id);
create policy "inner_voices-update-own" on public.inner_voices
  for update using (auth.uid() = user_id);
create policy "inner_voices-delete-own" on public.inner_voices
  for delete using (auth.uid() = user_id);
