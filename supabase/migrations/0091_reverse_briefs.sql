-- reverse_briefs: archaeology of belief from action.
--
-- Every productivity tool tells the user what they SHOULD do. None infer
-- what their actions reveal they ACTUALLY believe. A reverse brief
-- reads a day's behaviour (intentions set + completed/uncompleted,
-- standup today + blockers, decisions logged, reflections, daily
-- check-in, wins, commitments handled, calendar focus) and asks the
-- model: "looking at all this, what must this person have IMPLICITLY
-- believed to make these choices coherent?". Output is 3-6 implicit
-- beliefs in second-person voice ("You were treating X as more
-- important than Y"), each with the specific evidence trail and a
-- confidence rating, plus a 2-3 sentence summary. Optional CONFLICTS
-- block surfaces beliefs that contradict the user's stated identity
-- claims or active themes — the gap between who you say you are and
-- what you act like.
--
-- The user can ACKNOWLEDGE (yes that's what I was operating from),
-- CONTEST (no, here's what was really driving me), or DISMISS (the
-- signal is misleading).

create table if not exists public.reverse_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  brief_date date not null,

  implicit_beliefs jsonb not null default '[]'::jsonb,
  summary text not null,
  conflicts jsonb not null default '[]'::jsonb,

  source_summary text,
  source_counts jsonb not null default '{}'::jsonb,

  user_status text check (user_status in ('acknowledged','contested','dismissed')),
  user_note text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create unique index if not exists reverse_briefs_user_date_uniq
  on public.reverse_briefs (user_id, brief_date);

create index if not exists reverse_briefs_user_recent_idx
  on public.reverse_briefs (user_id, brief_date desc);

create index if not exists reverse_briefs_user_open_idx
  on public.reverse_briefs (user_id, brief_date desc)
  where user_status is null and archived_at is null;

create index if not exists reverse_briefs_user_pinned_idx
  on public.reverse_briefs (user_id, brief_date desc)
  where pinned = true and archived_at is null;

alter table public.reverse_briefs enable row level security;

create policy "reverse_briefs_select_own" on public.reverse_briefs
  for select using (auth.uid() = user_id);

create policy "reverse_briefs_insert_own" on public.reverse_briefs
  for insert with check (auth.uid() = user_id);

create policy "reverse_briefs_update_own" on public.reverse_briefs
  for update using (auth.uid() = user_id);

create policy "reverse_briefs_delete_own" on public.reverse_briefs
  for delete using (auth.uid() = user_id);
