-- Automation engine. Replaces ad-hoc cron with a unified
-- trigger → match → action-chain pipeline.
--
-- Model:
--   automations  = user-owned rules. Each has a trigger spec and an action
--                  chain. Created conversationally — "do X next time Y" — by
--                  the brain (see tools/automations.ts), never by a settings
--                  catalogue. Always opt-in; nothing fires unless the user
--                  explicitly created or accepted the suggestion.
--   automation_runs = full history of every fire. Used for debugging, the
--                     "what did jarvis do for me this week" view, and per-user
--                     rate limiting (cap N runs/day to bound cost blowups).
--   saved_places / saved_people = user's facts that automations reference by
--                     label ("Anna's", "mum"). Built up the same way: the user
--                     mentions them in chat, the brain saves them silently.
--
-- Trigger kinds (start small, extend as new sources come online):
--   cron               — recurring schedule (rrule string in trigger_spec)
--   location_arrived   — geofence enter (place_id + optional time window)
--   location_left      — geofence exit
--   email_received     — Gmail push, with optional filter (from/subject/etc)
--   bank_txn           — bank webhook, with amount/category filters
--   payment_received   — Stripe payment_intent.succeeded
--   calendar_event     — N min before any matching calendar event
--
-- Action chain shape (jsonb):
--   [
--     { "tool": "send_whatsapp",  "args": { "body": "Uber home from Anna's?" } },
--     { "tool": "wait_for_reply", "args": { "timeout_min": 10 } },
--     { "tool": "concierge_task", "args": { "goal": "Order Uber from {{place}} to home" } }
--   ]
-- The engine substitutes {{vars}} from the trigger payload + saved context
-- before dispatching each step.

create table if not exists public.automations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  -- Original natural-language description from the user. Kept for the UI list
  -- and so we can re-explain the rule back to them in their own words.
  description   text,
  trigger_kind  text not null check (trigger_kind in (
                  'cron',
                  'location_arrived',
                  'location_left',
                  'email_received',
                  'bank_txn',
                  'payment_received',
                  'calendar_event'
                )),
  -- Shape varies per kind. See lib/automation-engine.ts for type defs.
  trigger_spec  jsonb not null default '{}'::jsonb,
  action_chain  jsonb not null default '[]'::jsonb,
  -- If true, the engine sends a WhatsApp confirmation before running the
  -- action chain ("Uber home from Anna's?" → user replies yes → chain fires).
  -- Default true for anything that costs money or messages a third party.
  ask_first     boolean not null default true,
  enabled       boolean not null default true,
  last_fired_at timestamptz,
  fire_count    int not null default 0,
  -- For trigger_kind='cron': computed from the RRULE at create-time and after
  -- every fire. The cron worker scans for rows where next_fire_at <= now().
  -- Null for non-cron triggers.
  next_fire_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists automations_user_idx
  on public.automations(user_id);
create index if not exists automations_trigger_idx
  on public.automations(trigger_kind)
  where enabled;
create index if not exists automations_next_fire_idx
  on public.automations(next_fire_at)
  where enabled and trigger_kind = 'cron' and next_fire_at is not null;

alter table public.automations enable row level security;
create policy automations_owner on public.automations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


create table if not exists public.automation_runs (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid not null references public.automations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  trigger_payload jsonb,
  status          text not null default 'queued'
                  check (status in ('queued','running','awaiting_approval','done','failed','skipped')),
  -- Step-by-step output. Mirrors task_events for concierge — useful for the
  -- "what did jarvis do this week" view and for debugging chains that loop.
  steps           jsonb not null default '[]'::jsonb,
  result          jsonb,
  error           text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists automation_runs_user_idx
  on public.automation_runs(user_id, started_at desc);
create index if not exists automation_runs_automation_idx
  on public.automation_runs(automation_id, started_at desc);

alter table public.automation_runs enable row level security;
create policy automation_runs_owner on public.automation_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.automation_runs;


-- Saved places: the user's labelled geofences. Populated when the user says
-- "I'm at Anna's" / "this is my mum's" and shares a location once.
create table if not exists public.saved_places (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,
  address     text,
  lat         double precision,
  lng         double precision,
  -- Geofence radius. 150m is a sensible default for a home/flat — wide enough
  -- to handle GPS noise, narrow enough not to fire when you're driving past.
  radius_m    int not null default 150,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, label)
);

create index if not exists saved_places_user_idx on public.saved_places(user_id);
alter table public.saved_places enable row level security;
create policy saved_places_owner on public.saved_places
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- Saved people: labelled contacts. Lets automations target "mum" without the
-- user re-typing her number every time.
create table if not exists public.saved_people (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,
  full_name   text,
  phone_e164  text,
  email       text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, label)
);

create index if not exists saved_people_user_idx on public.saved_people(user_id);
alter table public.saved_people enable row level security;
create policy saved_people_owner on public.saved_people
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- Link notifications back to the automation_run that produced them. Lets the
-- WhatsApp inbound handler resolve "user replied YES" → which paused run to
-- resume. Nullable because most notifications don't come from automations.
alter table public.notifications
  add column if not exists automation_run_id uuid references public.automation_runs(id) on delete set null;
create index if not exists notifications_automation_run_idx
  on public.notifications(automation_run_id)
  where automation_run_id is not null;
