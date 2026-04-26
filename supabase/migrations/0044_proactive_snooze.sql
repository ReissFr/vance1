-- Temporary mute for proactive JARVIS. Set to a future timestamp to suppress
-- all proactive WhatsApp initiations until that point (meeting, vacation,
-- focus block). Null = no active snooze. Cron worker filters on
-- `snoozed_until IS NULL OR snoozed_until < now()`.
--
-- Deliberately separate from proactive_enabled so a snooze auto-expires
-- without the user having to remember to flip proactive back on.

alter table public.profiles
  add column if not exists proactive_snoozed_until timestamptz;
