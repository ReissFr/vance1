-- energy_forecasts: JARVIS's predictive read of how tomorrow (or any
-- target date) will feel — energy / mood / focus on 1-5 — based on
-- recent check-in arcs, day-of-week patterns, calendar load, recent
-- commitments, and recent heavy decisions. The forecast is paired with
-- a one-paragraph narrative + 2-4 recommendations (protect this, push
-- this, schedule that). When the user later logs a daily_checkin for
-- that date, the row's actual_* fields and accuracy_score get stamped
-- so JARVIS learns its own calibration of the user's body over time.

create table if not exists public.energy_forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  forecast_date date not null,
  forecast_at timestamptz not null default now(),

  energy_pred smallint not null check (energy_pred between 1 and 5),
  mood_pred smallint not null check (mood_pred between 1 and 5),
  focus_pred smallint not null check (focus_pred between 1 and 5),
  confidence smallint not null check (confidence between 1 and 5),

  narrative text not null,
  recommendations jsonb not null default '[]'::jsonb,

  source_summary text,
  source_counts jsonb not null default '{}'::jsonb,
  latency_ms int,
  model text,

  actual_energy smallint check (actual_energy between 1 and 5),
  actual_mood smallint check (actual_mood between 1 and 5),
  actual_focus smallint check (actual_focus between 1 and 5),
  accuracy_score smallint check (accuracy_score between 1 and 5),
  scored_at timestamptz,

  user_note text,
  pinned boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists energy_forecasts_user_date_idx
  on public.energy_forecasts (user_id, forecast_date desc);

create index if not exists energy_forecasts_user_unscored_idx
  on public.energy_forecasts (user_id, forecast_date desc)
  where scored_at is null;

create unique index if not exists energy_forecasts_user_date_unique
  on public.energy_forecasts (user_id, forecast_date);

alter table public.energy_forecasts enable row level security;

create policy "energy_forecasts_select_own" on public.energy_forecasts
  for select using (auth.uid() = user_id);

create policy "energy_forecasts_insert_own" on public.energy_forecasts
  for insert with check (auth.uid() = user_id);

create policy "energy_forecasts_update_own" on public.energy_forecasts
  for update using (auth.uid() = user_id);

create policy "energy_forecasts_delete_own" on public.energy_forecasts
  for delete using (auth.uid() = user_id);
