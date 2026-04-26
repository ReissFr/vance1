-- Ambient current-location tracking. Fed by the client-side LocationReporter
-- (navigator.geolocation → /api/location/update). Lives on profiles rather
-- than a history table because the brain only cares about "where is the user
-- right now?" — historical trails can come later if needed.

alter table public.profiles
  add column if not exists current_lat         double precision,
  add column if not exists current_lng         double precision,
  add column if not exists current_accuracy_m  double precision,
  add column if not exists current_location_at timestamptz;
