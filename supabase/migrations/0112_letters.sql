-- §173 — THE LETTERS ACROSS TIME ARCHIVE.
-- Letters the user writes to a FUTURE self, a PAST self, or a YOUNGER self.
--
-- The novel hook is the STATE-VECTOR SNAPSHOT. Every letter captures, at
-- compose time, who the user was when they wrote it: which vows were
-- active, which shoulds they were carrying, what futures they were
-- imagining, which thresholds they had recently crossed, what themes
-- their chats kept returning to. That snapshot becomes part of the letter.
--
-- For letters to past/younger selves, a SECOND snapshot is inferred from
-- the chat history at the target date — reconstructing who the recipient
-- was. Most journalling apps that offer "letters to your younger self"
-- give you a textbox and a date. This one delivers the letter alongside
-- proof of who you were when you wrote it AND who the recipient was.
--
-- For letters to future selves, the cron poller delivers them on
-- target_date via WhatsApp / web surfacing. The author_state_snapshot
-- arrives WITH the letter — future-you reads not just the words but the
-- state of self that wrote them.

create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  letter_text text not null check (length(letter_text) between 50 and 8000),
  -- direction:
  --   to_future_self   — delivered on target_date via cron
  --   to_past_self     — addressed to who you were on target_date
  --   to_younger_self  — addressed to who you were at an earlier date
  direction text not null check (direction in ('to_future_self', 'to_past_self', 'to_younger_self')),
  target_date date not null,
  title text check (title is null or length(title) between 4 and 120),
  -- optional 4-240 char prompt that nudged this letter (the question or
  -- frame the system or user used to write it):
  prompt_used text check (prompt_used is null or length(prompt_used) between 4 and 240),

  -- snapshot of the user at compose time — always populated:
  --   { vows: [{id, vow_text, weight, vow_age}],
  --     shoulds: [{id, should_text, weight}],
  --     imagined_futures: [{id, act_text, pull_kind, weight}],
  --     thresholds_recent: [{id, threshold_text, charge, magnitude}],
  --     themes: [string],
  --     conversation_count_30d: number,
  --     captured_at: iso }
  author_state_snapshot jsonb not null default '{}'::jsonb,
  -- snapshot of the recipient at target_date — populated for to_past_self
  -- and to_younger_self, NULL otherwise:
  target_state_snapshot jsonb,

  status text not null default 'scheduled' check (status in ('scheduled', 'delivered', 'archived')),
  delivered_at timestamptz,
  -- for to_past_self / to_younger_self letters that were never scheduled
  -- to be delivered (they're letters TO the past, not TO the future), we
  -- mark status='delivered' immediately at compose time:
  pinned boolean not null default false,

  -- delivery channel(s) used when delivered (jsonb because future
  -- channels may proliferate): {whatsapp: bool, email: bool, web: bool}
  delivery_channels jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists letters_user_target_date_idx
  on public.letters (user_id, target_date desc);
create index if not exists letters_user_direction_created_at_idx
  on public.letters (user_id, direction, created_at desc);
create index if not exists letters_due_for_delivery_idx
  on public.letters (target_date)
  where status = 'scheduled' and direction = 'to_future_self';
create index if not exists letters_user_pinned_idx
  on public.letters (user_id, created_at desc)
  where pinned = true;
create index if not exists letters_user_status_idx
  on public.letters (user_id, status, created_at desc);

alter table public.letters enable row level security;

create policy letters_select_own on public.letters
  for select using (auth.uid() = user_id);
create policy letters_insert_own on public.letters
  for insert with check (auth.uid() = user_id);
create policy letters_update_own on public.letters
  for update using (auth.uid() = user_id);
create policy letters_delete_own on public.letters
  for delete using (auth.uid() = user_id);

create or replace function public.touch_letters_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists letters_touch_updated_at on public.letters;
create trigger letters_touch_updated_at
  before update on public.letters
  for each row execute function public.touch_letters_updated_at();
