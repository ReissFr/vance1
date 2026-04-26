-- Per-user quiet hours for proactive JARVIS. Replaces the hardcoded
-- 22:00-08:00 window in lib/proactive-run.ts. Hours are integers in the
-- user's configured timezone (profiles.timezone). A span that crosses
-- midnight is detected when quiet_start_hour >= quiet_end_hour.
--
-- Defaults chosen to match the previous hardcoded behaviour so existing
-- users see no change after the migration runs.

alter table public.profiles
  add column if not exists quiet_start_hour smallint not null default 22,
  add column if not exists quiet_end_hour smallint not null default 8;

alter table public.profiles
  add constraint profiles_quiet_start_hour_chk
    check (quiet_start_hour >= 0 and quiet_start_hour <= 23) not valid;

alter table public.profiles
  add constraint profiles_quiet_end_hour_chk
    check (quiet_end_hour >= 0 and quiet_end_hour <= 23) not valid;

alter table public.profiles validate constraint profiles_quiet_start_hour_chk;
alter table public.profiles validate constraint profiles_quiet_end_hour_chk;
