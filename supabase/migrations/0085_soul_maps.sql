-- soul_maps: a versioned graph of who the user IS at a given moment.
-- Nodes are pulled from identity_claims (am/value/refuse/becoming/aspire),
-- themes (active narrative threads), policies (rules), goals (active),
-- decisions (last 90d), and people (importance>=2). Edges are inferred
-- by Haiku — supports / tension / shapes / anchors / connects — each with
-- a 1-5 strength and a one-line note quoting evidence.
--
-- The point isn't a pretty graph. It's that the user can SEE their inner
-- architecture, and across many maps watch nodes drift, cluster, or
-- detach over time. A node that lit up in March but has no edges in
-- June is a value the user has stopped enacting. A new high-strength
-- edge between "ship daily" and "no meetings before 11" is evidence
-- that two parts of the user's stated identity are now reinforcing each
-- other in their actual choices.
--
-- nodes / edges are stored as jsonb so the table doesn't need
-- schema changes when we add new node kinds. Each map is a snapshot —
-- regenerating produces a NEW row with parent_id pointing at the previous
-- one, so the user can scrub their identity-graph through time.

create table if not exists public.soul_maps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  nodes jsonb not null,
  edges jsonb not null,

  centroid_summary text,
  drift_summary text,

  parent_id uuid references public.soul_maps(id) on delete set null,
  source_counts jsonb not null default '{}'::jsonb,

  pinned boolean not null default false,
  archived_at timestamptz,
  user_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists soul_maps_user_recent_idx
  on public.soul_maps (user_id, created_at desc);

create index if not exists soul_maps_user_pinned_idx
  on public.soul_maps (user_id, created_at desc)
  where pinned = true and archived_at is null;

alter table public.soul_maps enable row level security;

create policy "soul_maps_select_own" on public.soul_maps
  for select using (auth.uid() = user_id);

create policy "soul_maps_insert_own" on public.soul_maps
  for insert with check (auth.uid() = user_id);

create policy "soul_maps_update_own" on public.soul_maps
  for update using (auth.uid() = user_id);

create policy "soul_maps_delete_own" on public.soul_maps
  for delete using (auth.uid() = user_id);
