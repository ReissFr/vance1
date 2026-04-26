-- Track when each user finished the first-run onboarding wizard so the home
-- page can redirect back to it until they complete the flow. Nullable: a
-- non-null value == done. Stamped by PATCH /api/profile.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;
