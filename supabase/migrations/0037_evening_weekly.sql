-- Phase: evening wrap-up and weekly review opt-in flags.
-- Evening wrap (22:00 London): recap of what actually happened today — calendar
-- events attended, revenue landed, open loops still outstanding, tomorrow peek.
-- Weekly review (Sunday 18:00 London): 7-day retrospective — shipped vs slipped,
-- revenue trend, top merchants, top receivers of your time, what to double down on.

alter table public.profiles
  add column if not exists evening_wrap_enabled boolean not null default false;

alter table public.profiles
  add column if not exists weekly_review_enabled boolean not null default false;

create index if not exists profiles_evening_wrap_enabled_idx
  on public.profiles(evening_wrap_enabled)
  where evening_wrap_enabled = true;

create index if not exists profiles_weekly_review_enabled_idx
  on public.profiles(weekly_review_enabled)
  where weekly_review_enabled = true;
