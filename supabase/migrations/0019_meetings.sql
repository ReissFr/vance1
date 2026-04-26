-- Phase: Meeting Ghost + Earpiece Coach.
--
-- A meeting session is any window where JARVIS is actively listening to the
-- user's mic (in-person convo, Zoom call in a tab, anything). The session
-- owns an ordered list of transcript segments which we later summarise and
-- fold into recall_events as source='meeting' so search hits everything.

create table if not exists public.meeting_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  title      text,
  summary    text,
  action_items text,
  participants text[] default '{}',
  recall_event_id uuid references public.recall_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists meeting_sessions_user_time_idx
  on public.meeting_sessions(user_id, started_at desc);

create table if not exists public.meeting_segments (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  text       text not null,
  created_at timestamptz not null default now()
);

create index if not exists meeting_segments_session_time_idx
  on public.meeting_segments(session_id, started_at);

create index if not exists meeting_segments_user_time_idx
  on public.meeting_segments(user_id, started_at desc);

-- RLS
alter table public.meeting_sessions enable row level security;
alter table public.meeting_segments enable row level security;

drop policy if exists "users read own meetings" on public.meeting_sessions;
create policy "users read own meetings"
  on public.meeting_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "users read own segments" on public.meeting_segments;
create policy "users read own segments"
  on public.meeting_segments for select
  using (auth.uid() = user_id);
