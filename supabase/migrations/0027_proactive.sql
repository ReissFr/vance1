-- Phase: proactive layer. Opt-in flag + per-user state for the opportunistic
-- "JARVIS initiates" loop. Separate consent from briefing_enabled (morning
-- digest is one expected message/day; proactive can interrupt during the day).

alter table public.profiles
  add column if not exists proactive_enabled boolean not null default false;

create index if not exists profiles_proactive_enabled_idx
  on public.profiles(proactive_enabled)
  where proactive_enabled = true;

-- Per-user state driving rate-limit and signal diffing. One row per user.
-- Written by /api/cron/run-proactive on every tick.
create table if not exists public.proactive_state (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  -- Last time we actually sent the user a proactive WhatsApp.
  last_ping_at              timestamptz,
  -- Last time the judge ran for this user (even if it decided not to ping).
  last_tick_at              timestamptz,
  -- Day bucket for pings_today counter. Reset when judge sees a new day.
  day_key                   date not null default current_date,
  pings_today               integer not null default 0,
  -- Signal cursors. We advance these each tick so we don't re-judge the same
  -- email / calendar state over and over.
  last_seen_email_id        text,
  last_seen_calendar_hash   text,
  -- The most recent proactive topic we pinged on. Helps the judge avoid
  -- double-pinging on the same subject within a short window.
  last_ping_topic           text,
  updated_at                timestamptz not null default now()
);

alter table public.proactive_state enable row level security;

-- Users can see their own state (for a future "what has JARVIS been watching"
-- UI). Writes go through service-role from the cron runner, not from clients.
create policy proactive_state_own_read
  on public.proactive_state
  for select
  using (auth.uid() = user_id);
