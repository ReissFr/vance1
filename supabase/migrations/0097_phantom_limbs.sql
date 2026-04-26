-- §158 Phantom Limb Detector
--
-- Each row represents a "moved-on claim" the user made about a topic, plus
-- the count of times they have mentioned the same topic since that claim.
-- The thing you said you put down but keep bringing up.
--
-- Where §156 (promises) tracks forward-looking commitments ("I will do X"),
-- this tracks backward-looking move-on claims ("I'm done with X") and
-- whether the user actually was. The most uncomfortable mirror in JARVIS
-- after the Promise Ledger.

create table if not exists public.phantom_limbs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  topic text not null,                          -- noun phrase: "Sarah", "the agency project", "drinking"
  topic_aliases jsonb not null default '[]'::jsonb,  -- ["agency", "the agency", "the project"]

  claim_text text not null,                     -- verbatim quote of the move-on claim
  claim_kind text not null check (claim_kind in (
    'done_with','moved_on','let_go','no_longer_thinking',
    'finished','past_it','not_my_problem','put_down'
  )),
  claim_date date not null,
  claim_message_id uuid,
  claim_conversation_id uuid,

  days_since_claim int not null,
  post_mention_count int not null default 0,    -- distinct messages mentioning topic AFTER claim
  post_mention_days int not null default 0,     -- distinct calendar days
  post_mentions jsonb not null default '[]'::jsonb,  -- [{date, snippet, msg_id}] up to 8 most recent

  haunting_score smallint not null check (haunting_score between 1 and 5),
  -- 5 = many mentions, recent, intense; 1 = barely a flicker.

  status text not null default 'pending' check (status in (
    'pending','acknowledged','contested','resolved','dismissed'
  )),
  status_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists phantom_limbs_user_recent_idx
  on public.phantom_limbs (user_id, created_at desc);
create index if not exists phantom_limbs_user_pending_idx
  on public.phantom_limbs (user_id, haunting_score desc, post_mention_count desc)
  where status = 'pending' and archived_at is null;
create index if not exists phantom_limbs_user_pinned_idx
  on public.phantom_limbs (user_id, created_at desc) where pinned = true;
create index if not exists phantom_limbs_scan_idx
  on public.phantom_limbs (scan_id);

alter table public.phantom_limbs enable row level security;

drop policy if exists "phantom_limbs-select-own" on public.phantom_limbs;
drop policy if exists "phantom_limbs-insert-own" on public.phantom_limbs;
drop policy if exists "phantom_limbs-update-own" on public.phantom_limbs;
drop policy if exists "phantom_limbs-delete-own" on public.phantom_limbs;

create policy "phantom_limbs-select-own" on public.phantom_limbs
  for select using (auth.uid() = user_id);
create policy "phantom_limbs-insert-own" on public.phantom_limbs
  for insert with check (auth.uid() = user_id);
create policy "phantom_limbs-update-own" on public.phantom_limbs
  for update using (auth.uid() = user_id);
create policy "phantom_limbs-delete-own" on public.phantom_limbs
  for delete using (auth.uid() = user_id);
