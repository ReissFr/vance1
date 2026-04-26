-- §159 Pivot Map
--
-- Each row is a "pivot moment" — an inflection point where the user changed
-- direction. Verbal pivots ("actually, scrap that"), thematic pivots (a
-- topic warm last week, cold this week), stance reversals, abandonments,
-- recommitments. Plus the deterministic follow-through and back-slide
-- counts so we know whether the pivot actually stuck.
--
-- Most of life's momentum lives in inflection points, but they go
-- unnamed. Therapy catches one a session. Journaling apps store entries.
-- Nobody mines your own typed words for the moments you turned.

create table if not exists public.pivots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  pivot_text text not null,                       -- verbatim quote of the pivot moment
  pivot_kind text not null check (pivot_kind in (
    'verbal','thematic','stance_reversal','abandonment','recommitment'
  )),
  domain text not null check (domain in (
    'work','relationships','health','identity','finance','creative','learning','daily','other'
  )),
  pivot_date date not null,
  pivot_message_id uuid,
  pivot_conversation_id uuid,

  from_state text not null,                       -- one-line: what the user was doing/believing BEFORE
  to_state text not null,                         -- one-line: what they shifted toward
  from_aliases jsonb not null default '[]'::jsonb,  -- noun phrases identifying the OLD direction
  to_aliases jsonb not null default '[]'::jsonb,    -- noun phrases identifying the NEW direction

  days_since_pivot int not null,
  follow_through_count int not null default 0,    -- mentions of NEW direction since pivot
  follow_through_days int not null default 0,     -- distinct calendar days
  back_slide_count int not null default 0,        -- mentions of OLD direction since pivot
  back_slide_days int not null default 0,         -- distinct calendar days

  follow_through_samples jsonb not null default '[]'::jsonb,  -- [{date, snippet}] up to 5 receipts
  back_slide_samples jsonb not null default '[]'::jsonb,      -- [{date, snippet}] up to 5 receipts

  pivot_quality text not null check (pivot_quality in (
    'stuck','performed','reverted','quiet','too_recent'
  )),
  -- stuck    = strong follow-through, little back-slide
  -- performed = pivot was declared but no follow-through and no back-slide (vapour)
  -- reverted = back-slide outweighs follow-through (you went back)
  -- quiet    = small signals on both sides, hard to tell
  -- too_recent = <7 days, not enough time to judge

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending','acknowledged','contested','superseded','dismissed'
  )),
  status_note text,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists pivots_user_recent_idx
  on public.pivots (user_id, pivot_date desc);
create index if not exists pivots_user_pending_idx
  on public.pivots (user_id, pivot_date desc)
  where status = 'pending' and archived_at is null;
create index if not exists pivots_user_quality_idx
  on public.pivots (user_id, pivot_quality, pivot_date desc);
create index if not exists pivots_user_pinned_idx
  on public.pivots (user_id, pivot_date desc) where pinned = true;
create index if not exists pivots_scan_idx
  on public.pivots (scan_id);

alter table public.pivots enable row level security;

drop policy if exists "pivots-select-own" on public.pivots;
drop policy if exists "pivots-insert-own" on public.pivots;
drop policy if exists "pivots-update-own" on public.pivots;
drop policy if exists "pivots-delete-own" on public.pivots;

create policy "pivots-select-own" on public.pivots
  for select using (auth.uid() = user_id);
create policy "pivots-insert-own" on public.pivots
  for insert with check (auth.uid() = user_id);
create policy "pivots-update-own" on public.pivots
  for update using (auth.uid() = user_id);
create policy "pivots-delete-own" on public.pivots
  for delete using (auth.uid() = user_id);
