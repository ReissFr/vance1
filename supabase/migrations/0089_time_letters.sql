-- time_letters: messages from one of the user's selves to another, with
-- optional date-locked delivery. Three kinds:
--
--   * forward  — written today, delivered on target_date via WhatsApp.
--                The "letter to your future self" — sealed envelope.
--
--   * backward — generated NOW from the user's actual entries within a
--                window ending at written_at_date. Voiced as if past-self
--                wrote it ("Here's what I was wrestling with..."). The
--                novelty: the letter quotes ACTUAL decisions/reflections
--                from that era, so reading it is reading what you really
--                were thinking, in first-person letter form.
--
--   * posterity — written today, voiced FROM today TO a past version of
--                yourself ("Things I wish I'd told you back then"). No
--                delivery — just stored for the user to revisit.
--
-- Forward letters get fired by a daily cron checking target_date <= today
-- and delivered_at is null. Once delivered, the user reads them in the
-- console and can leave a user_note ("I was right" / "I was wrong" /
-- "I forgot I felt that way").

create table if not exists public.time_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('forward','backward','posterity')),
  title text not null,
  body text not null,

  -- Perspective date. For FORWARD: today (when sealed). For BACKWARD:
  -- the past date the letter is voiced FROM. For POSTERITY: the past
  -- date the letter is addressed TO.
  written_at_date date not null,

  -- For FORWARD only — the date the letter unlocks and gets delivered.
  -- Null for backward / posterity.
  target_date date,

  delivered_at timestamptz,
  delivered_via text check (delivered_via in ('whatsapp','web','manual')),

  -- For BACKWARD letters — what evidence powered the synthesis.
  source_summary text,
  source_counts jsonb not null default '{}'::jsonb,
  latency_ms int,
  model text,

  user_note text,
  pinned boolean not null default false,
  archived_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists time_letters_user_recent_idx
  on public.time_letters (user_id, created_at desc);

create index if not exists time_letters_user_pending_idx
  on public.time_letters (user_id, target_date)
  where kind = 'forward' and delivered_at is null and cancelled_at is null and archived_at is null;

create index if not exists time_letters_due_global_idx
  on public.time_letters (target_date)
  where kind = 'forward' and delivered_at is null and cancelled_at is null and archived_at is null;

create index if not exists time_letters_user_pinned_idx
  on public.time_letters (user_id, created_at desc)
  where pinned = true and archived_at is null;

alter table public.time_letters enable row level security;

create policy "time_letters_select_own" on public.time_letters
  for select using (auth.uid() = user_id);

create policy "time_letters_insert_own" on public.time_letters
  for insert with check (auth.uid() = user_id);

create policy "time_letters_update_own" on public.time_letters
  for update using (auth.uid() = user_id);

create policy "time_letters_delete_own" on public.time_letters
  for delete using (auth.uid() = user_id);
