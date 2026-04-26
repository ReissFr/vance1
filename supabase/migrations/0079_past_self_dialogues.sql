-- past_self_dialogues + past_self_messages: real conversations with
-- the user as they WERE — at a specific point in their own history.
-- Past-self speaks in first person from that moment, conditioned on the
-- evidence the user themselves wrote AROUND that anchor date
-- (reflections, decisions, wins, intentions, check-ins, standups, even
-- memories). Past-self has no knowledge of anything after the anchor.
--
-- Why this works (and isn't nostalgia):
--   The persona is built from a 60-day window centred on the anchor
--   date. The past-self's tone, themes, mood, fears, hopes, and active
--   work are drawn from the user's actual writing at that time. So
--   "what would 1-year-ago me say about this" stops being vibes and
--   becomes "given you literally wrote X and chose Y back then, here's
--   what that version of you would say".
--
-- Each dialogue stores its persona_snapshot inline at creation time.
-- This is intentional: re-running on the same anchor gives you a fresh
-- dialogue, but the original keeps its frozen persona.
--
-- horizon labels (used for the UI quick-pick — anchor_date is the
-- authoritative source):
--   '3_months_ago' | '6_months_ago' | '1_year_ago' | '2_years_ago' |
--   '3_years_ago' | 'custom'

create table if not exists public.past_self_dialogues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  anchor_date date not null,
  horizon_label text not null default '1_year_ago'
    check (horizon_label in (
      '3_months_ago','6_months_ago','1_year_ago',
      '2_years_ago','3_years_ago','custom'
    )),

  persona_snapshot jsonb not null default '{}',

  title text,
  pinned boolean not null default false,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists past_self_dialogues_user_active_idx
  on public.past_self_dialogues (user_id, updated_at desc)
  where archived_at is null;

create index if not exists past_self_dialogues_user_pinned_idx
  on public.past_self_dialogues (user_id, updated_at desc)
  where pinned = true and archived_at is null;

alter table public.past_self_dialogues enable row level security;

create policy "past_self_dialogues: select own"
  on public.past_self_dialogues for select
  using (auth.uid() = user_id);

create policy "past_self_dialogues: insert own"
  on public.past_self_dialogues for insert
  with check (auth.uid() = user_id);

create policy "past_self_dialogues: update own"
  on public.past_self_dialogues for update
  using (auth.uid() = user_id);

create policy "past_self_dialogues: delete own"
  on public.past_self_dialogues for delete
  using (auth.uid() = user_id);


create table if not exists public.past_self_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dialogue_id uuid not null references public.past_self_dialogues(id) on delete cascade,

  role text not null check (role in ('user','past_self')),
  content text not null,

  created_at timestamptz not null default now()
);

create index if not exists past_self_messages_dialogue_idx
  on public.past_self_messages (dialogue_id, created_at);

alter table public.past_self_messages enable row level security;

create policy "past_self_messages: select own"
  on public.past_self_messages for select
  using (auth.uid() = user_id);

create policy "past_self_messages: insert own"
  on public.past_self_messages for insert
  with check (auth.uid() = user_id);

create policy "past_self_messages: update own"
  on public.past_self_messages for update
  using (auth.uid() = user_id);

create policy "past_self_messages: delete own"
  on public.past_self_messages for delete
  using (auth.uid() = user_id);
