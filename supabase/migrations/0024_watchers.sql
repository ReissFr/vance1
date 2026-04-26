-- Watchers expansion of the automations engine. Adds two new trigger kinds:
--
--   periodic_check   — cron-timed watcher. Every interval_minutes, the engine
--                      evaluates a natural-language check prompt against the
--                      user's data (brain does the reasoning with tools). If
--                      the check returns a match, the action chain fires. One
--                      primitive covers price watches, "watch Tokyo flights
--                      under £400", "watch for X in my inbox every 30 min",
--                      evening wrap summaries, etc.
--
--   inbound_message  — fires when a WhatsApp/SMS lands, with optional media
--                      filter (has_media, keyword_contains, from_contains).
--                      Covers photo inbox: "forward a receipt photo → JARVIS
--                      extracts + files". Can be set to swallow=true so the
--                      brain doesn't also reply conversationally.
--
-- Plus runtime state columns so watchers can remember what they've already
-- fired on (calendar event ids, last check result, etc).

alter table public.automations
  drop constraint if exists automations_trigger_kind_check;

alter table public.automations
  add constraint automations_trigger_kind_check
  check (trigger_kind in (
    'cron',
    'location_arrived',
    'location_left',
    'email_received',
    'bank_txn',
    'payment_received',
    'calendar_event',
    'periodic_check',
    'inbound_message'
  ));

-- Last time the watcher was evaluated (for periodic_check and calendar_event).
-- Lets the cron worker skip a rule until interval_minutes has elapsed since
-- the previous check. NULL means "never checked, run immediately".
alter table public.automations
  add column if not exists last_checked_at timestamptz;

-- Opaque runtime state. Used by triggers that need to remember things across
-- ticks (e.g. calendar_event stores the set of event_ids already fired for;
-- periodic_check stores the previous-match value so you can fire on change
-- rather than every time the condition is true).
alter table public.automations
  add column if not exists state jsonb not null default '{}'::jsonb;

create index if not exists automations_last_checked_idx
  on public.automations(last_checked_at)
  where enabled and trigger_kind in ('periodic_check', 'calendar_event');

-- For photo inbox. Media URLs Twilio sends on inbound WhatsApp/SMS. Stored so
-- an automation or the brain can fetch the image later.
alter table public.inbound_messages
  add column if not exists media_urls text[];

alter table public.inbound_messages
  add column if not exists media_type text;
