-- §163 Self-Erasure Register
--
-- Each row is a moment the user OVERRULED their own thought mid-stream —
-- where a second voice cancelled the first. Five kinds of erasure:
--   self_dismissal       — "ignore me", "forget I said anything", "don't mind me"
--   cancellation         — "never mind", "scratch that", "actually nothing"
--   self_pathologising   — "I'm being silly/weird/dramatic/stupid", "overthinking"
--   minimisation         — "probably nothing", "doesn't matter", "small thing but"
--   truncation           — "I was going to say..." then trailing off, "I almost..."
--
-- The structural artifact this captures: the SECOND VOICE that interrupts
-- the first. Every erasure is a censor catching a thought after it has
-- already begun. The mining captures both the erasure phrase AND the
-- preceding line — what was being said when the censor stepped in.
--
-- The reframe mechanic: status='restored' + status_note = the user
-- typing what they actually wanted to say before they cancelled it.
-- "Restoring the thought" is the move that turns the ledger from
-- diagnosis into tool.
--
-- recurrence tracks how often the user erases in the same shape; chronic
-- patterns reveal which TOPICS the second voice always censors. recurrence_
-- with_target counts recurrences that ALSO had a preceding thought worth
-- erasing (i.e. the censor isn't just verbal tic — it's catching real
-- content).
--
-- No therapy/journaling app captures self-erasure as structural self-
-- censorship. Most apps treat the user's typed words as a transcript;
-- this treats them as the OUTPUT of an internal editor that the user
-- has the right to overrule.

create table if not exists public.self_erasures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  erasure_text text not null,                          -- verbatim erasure phrase ≤200 chars
  erasure_kind text not null check (erasure_kind in (
    'self_dismissal','cancellation','self_pathologising','minimisation','truncation'
  )),

  what_was_erased text,                                -- the preceding line/thought being cancelled (≤320 chars)
  what_was_erased_kind text check (what_was_erased_kind in (
    'feeling','need','observation','request','opinion','memory','idea','complaint','unknown'
  )),

  censor_voice text,                                   -- 2-5 word inferred internal voice — "the editor", "the reasonable one", "the don't-be-a-burden voice", "the calm-it-down voice"

  domain text not null check (domain in (
    'work','relationships','health','identity','finance','creative','learning','daily','other'
  )),
  spoken_date date not null,
  spoken_message_id uuid,
  spoken_conversation_id uuid,

  recurrence_count int not null default 1,             -- DISTINCT messages with the same erasure shape across the window
  recurrence_days int not null default 1,
  recurrence_with_target int not null default 0,       -- recurrences that also had a preceding thought (not just verbal tic)
  recurrence_samples jsonb not null default '[]'::jsonb,  -- [{date, snippet}] up to 5 PRIOR-IN-WINDOW erasures of same shape

  pattern_severity smallint not null check (pattern_severity between 1 and 5),
  -- 5 = recurrence ≥12 with target ≥5 — reflex self-cancellation
  -- 4 = recurrence ≥8 with target ≥3 — entrenched censor
  -- 3 = recurrence ≥4 with kind in (self_pathologising, self_dismissal) — habitual self-deletion
  -- 2 = recurrence ≥3 mixed
  -- 1 = isolated erasure

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending','restored','released','noted','dismissed'
  )),
  -- restored  = user typed what they actually wanted to say (status_note = restored_text)
  -- released  = user explicitly chose to keep the erasure (status_note = release reason)
  -- noted     = acknowledged but neither restored nor released
  -- dismissed = not actually a self-erasure (false positive)
  status_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists self_erasures_user_recent_idx
  on public.self_erasures (user_id, spoken_date desc);
create index if not exists self_erasures_user_pending_severity_idx
  on public.self_erasures (user_id, pattern_severity desc, spoken_date desc)
  where status = 'pending' and archived_at is null;
create index if not exists self_erasures_user_kind_idx
  on public.self_erasures (user_id, erasure_kind, spoken_date desc);
create index if not exists self_erasures_user_pinned_idx
  on public.self_erasures (user_id, spoken_date desc) where pinned = true;
create index if not exists self_erasures_scan_idx
  on public.self_erasures (scan_id);

alter table public.self_erasures enable row level security;

drop policy if exists "self-erasures-select-own" on public.self_erasures;
drop policy if exists "self-erasures-insert-own" on public.self_erasures;
drop policy if exists "self-erasures-update-own" on public.self_erasures;
drop policy if exists "self-erasures-delete-own" on public.self_erasures;

create policy "self-erasures-select-own" on public.self_erasures
  for select using (auth.uid() = user_id);
create policy "self-erasures-insert-own" on public.self_erasures
  for insert with check (auth.uid() = user_id);
create policy "self-erasures-update-own" on public.self_erasures
  for update using (auth.uid() = user_id);
create policy "self-erasures-delete-own" on public.self_erasures
  for delete using (auth.uid() = user_id);
