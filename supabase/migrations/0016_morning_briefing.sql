-- Phase: morning briefing opt-in flag.
-- When true and profiles.mobile_e164 is set, the daily cron at 07:00 London
-- time will synthesise a WhatsApp briefing for this user.

alter table public.profiles
  add column if not exists briefing_enabled boolean not null default false;

create index if not exists profiles_briefing_enabled_idx
  on public.profiles(briefing_enabled)
  where briefing_enabled = true;
