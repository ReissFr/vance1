-- Phase: feature library / app-store for JARVIS.
-- Tracks per-user enable/disable overrides. Feature defaults live in code
-- (apps/web/lib/features.ts) so a missing row = use the default for that
-- feature. Explicit rows override the default in either direction.

create table if not exists public.user_features (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_id text not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_id)
);

create index if not exists user_features_user_idx
  on public.user_features(user_id);

alter table public.user_features enable row level security;

create policy "users read own feature flags"
  on public.user_features for select
  using (auth.uid() = user_id);

-- Writes go through the server (service role) so the app can validate
-- feature ids against the registry before accepting a toggle.
