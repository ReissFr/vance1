-- §162 Permission Ledger
--
-- Each row is a moment the user sought AUTHORISATION for something they
-- should not have needed permission for. Five kinds:
--   explicit_permission  — "is it ok if I take a day off"
--   justification        — "I should be allowed to skip this because"
--   self_doubt           — "is it bad that I want to leave"
--   comparison_to_norm   — "do most people do this", "is this normal"
--   future_excuse        — "I'm probably going to do X but"
--
-- Each row records the requested_action (1-5 word noun phrase — what was
-- being asked permission FOR), the implicit_authority (the audience the
-- user is imagining might disapprove — self_judge, partner, parent,
-- professional_norm, social_norm, friend, work_authority, financial_judge,
-- or abstract_other), the urgency_score (1-5 how charged the seeking is),
-- and the status. status='granted' means the user wrote their OWN self-
-- permission grant — locking in "I am allowed to X" — and status_note
-- stores the grant text.
--
-- Phase 2 (deterministic) tracks RECURRENCE of the same requested_action
-- across the window — e.g. "you have sought permission for 'taking time
-- off' 14 times in 90 days, all to the same imagined authority (your
-- business)". That's the load-bearing pattern: chronic permission-seeking
-- about the same thing reveals where the user has externalised authority
-- they could have kept.
--
-- No therapy/journaling/productivity app surfaces permission-seeking-as-
-- structural-deference.

create table if not exists public.permission_seekings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  request_text text not null,                          -- verbatim quote ≤320 chars
  request_kind text not null check (request_kind in (
    'explicit_permission','justification','self_doubt','comparison_to_norm','future_excuse'
  )),
  requested_action text not null,                      -- 1-5 word noun phrase: "take a day off", "skip the meeting", "say no to my dad", "buy the watch"
  action_aliases jsonb not null default '[]'::jsonb,   -- 1-5 aliases the user might use to refer to the same action

  implicit_authority text not null check (implicit_authority in (
    'self_judge','partner','parent','professional_norm','social_norm','friend','work_authority','financial_judge','abstract_other'
  )),
  -- self_judge        = the inner critic / "I shouldn't need permission but" / "is it bad that I"
  -- partner           = romantic partner is the imagined disapprover
  -- parent            = parent / family elder is the imagined disapprover
  -- professional_norm = "is this allowed in my field" / industry standard
  -- social_norm       = "do people do this" / general social acceptability
  -- friend            = peer group / friend group
  -- work_authority    = boss / client / team / business
  -- financial_judge   = the imagined judge of how money is spent
  -- abstract_other    = no specific audience identified — generic "is this ok"

  urgency_score smallint not null check (urgency_score between 1 and 5),
  -- 5 = very charged, repeated in the same message, multiple hedges
  -- 4 = clearly seeking, slightly hedged
  -- 3 = mild seeking, neutral language
  -- 2 = passing seeking, almost rhetorical
  -- 1 = trace of seeking, ambiguous

  domain text not null check (domain in (
    'work','relationships','health','identity','finance','creative','learning','daily','other'
  )),
  spoken_date date not null,
  spoken_message_id uuid,
  spoken_conversation_id uuid,

  recurrence_count int not null default 1,             -- DISTINCT messages seeking permission for the same action across the window (including this one)
  recurrence_days int not null default 1,
  recurrence_samples jsonb not null default '[]'::jsonb,  -- [{date, snippet}] up to 5 PRIOR-IN-WINDOW seekings about the same action

  pattern_severity smallint not null check (pattern_severity between 1 and 5),
  -- 5 = recurrence ≥10 with same imagined_authority — chronic deference
  -- 4 = recurrence ≥6 with same authority
  -- 3 = recurrence ≥3 with high urgency (urgency_score ≥4 average)
  -- 2 = recurrence ≥3 mixed
  -- 1 = isolated seeking

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending','acknowledged','contested','granted','dismissed'
  )),
  -- granted = user wrote their own self-permission grant ("I am allowed to X. I don't need permission for this.") — status_note stores the grant
  status_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists permission_seekings_user_recent_idx
  on public.permission_seekings (user_id, spoken_date desc);
create index if not exists permission_seekings_user_pending_severity_idx
  on public.permission_seekings (user_id, pattern_severity desc, spoken_date desc)
  where status = 'pending' and archived_at is null;
create index if not exists permission_seekings_user_action_idx
  on public.permission_seekings (user_id, requested_action, spoken_date desc);
create index if not exists permission_seekings_user_pinned_idx
  on public.permission_seekings (user_id, spoken_date desc) where pinned = true;
create index if not exists permission_seekings_scan_idx
  on public.permission_seekings (scan_id);

alter table public.permission_seekings enable row level security;

drop policy if exists "permission-seekings-select-own" on public.permission_seekings;
drop policy if exists "permission-seekings-insert-own" on public.permission_seekings;
drop policy if exists "permission-seekings-update-own" on public.permission_seekings;
drop policy if exists "permission-seekings-delete-own" on public.permission_seekings;

create policy "permission-seekings-select-own" on public.permission_seekings
  for select using (auth.uid() = user_id);
create policy "permission-seekings-insert-own" on public.permission_seekings
  for insert with check (auth.uid() = user_id);
create policy "permission-seekings-update-own" on public.permission_seekings
  for update using (auth.uid() = user_id);
create policy "permission-seekings-delete-own" on public.permission_seekings
  for delete using (auth.uid() = user_id);
