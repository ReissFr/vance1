-- future_self_dialogues + future_self_messages: real conversations with
-- a simulated future version of the user, conditioned on the latest
-- trajectory projection + active identity claims + active goals +
-- active themes. The future-self speaks in character, grounded in
-- evidence from the user's own data.
--
-- Why this works (and isn't fantasy):
--   The future-self persona is built from a SNAPSHOT — the latest 6 or
--   12-month trajectory body, the active "I am / I value / I refuse"
--   claims, the open goals, the active themes. The persona has actual
--   substance to draw on. It's not "imagine if". It's "given you've
--   said you value X and you're projecting toward Y, here's what
--   future-you would say".
--
-- Each dialogue stores its persona_snapshot inline at creation time.
-- This is intentional: even if the underlying trajectory changes
-- later, the dialogue stays consistent with the future-self the user
-- was actually talking to. Re-running creates a new dialogue.
--
-- horizon: which future-self the user is talking to.
--   '6_months' | '12_months' | '5_years'  (5-year is more imaginative —
--   trajectory body covers 6/12, so for 5_years the persona is
--   conditioned on identity + values + goals projected forward without
--   the trajectory body anchor).

create table if not exists public.future_self_dialogues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  horizon text not null default '12_months'
    check (horizon in ('6_months','12_months','5_years')),

  trajectory_id uuid references public.trajectories(id) on delete set null,
  persona_snapshot jsonb not null default '{}',

  title text,
  pinned boolean not null default false,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists future_self_dialogues_user_active_idx
  on public.future_self_dialogues (user_id, updated_at desc)
  where archived_at is null;

create index if not exists future_self_dialogues_user_pinned_idx
  on public.future_self_dialogues (user_id, updated_at desc)
  where pinned = true and archived_at is null;

alter table public.future_self_dialogues enable row level security;

create policy "future_self_dialogues: select own"
  on public.future_self_dialogues for select
  using (auth.uid() = user_id);

create policy "future_self_dialogues: insert own"
  on public.future_self_dialogues for insert
  with check (auth.uid() = user_id);

create policy "future_self_dialogues: update own"
  on public.future_self_dialogues for update
  using (auth.uid() = user_id);

create policy "future_self_dialogues: delete own"
  on public.future_self_dialogues for delete
  using (auth.uid() = user_id);


create table if not exists public.future_self_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dialogue_id uuid not null references public.future_self_dialogues(id) on delete cascade,

  role text not null check (role in ('user','future_self')),
  content text not null,

  created_at timestamptz not null default now()
);

create index if not exists future_self_messages_dialogue_idx
  on public.future_self_messages (dialogue_id, created_at);

alter table public.future_self_messages enable row level security;

create policy "future_self_messages: select own"
  on public.future_self_messages for select
  using (auth.uid() = user_id);

create policy "future_self_messages: insert own"
  on public.future_self_messages for insert
  with check (auth.uid() = user_id);

create policy "future_self_messages: update own"
  on public.future_self_messages for update
  using (auth.uid() = user_id);

create policy "future_self_messages: delete own"
  on public.future_self_messages for delete
  using (auth.uid() = user_id);
