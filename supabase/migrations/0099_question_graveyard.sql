-- §160 Question Graveyard
--
-- Each row is a QUESTION the user asked themselves and never answered. The
-- difference from §155 (conversation loops): loops are RECURRING questions
-- the user circles. The Graveyard catches questions that may have been asked
-- only once but were never answered, never closed, and have been sitting in
-- the dark since.
--
-- Phase 2 looks for evidence of an answer in subsequent messages — certainty
-- markers near the question's topic terms ("I've decided X", "I'll Y", "the
-- answer is Z"). If no answer signal is found, the question is unanswered
-- and lives in the graveyard.
--
-- Therapy might catch one of these in a session. Journaling apps don't track
-- unanswered self-questions across months. Productivity apps don't know
-- about questions at all. Nobody mines your own typed words for the
-- questions you asked into the void and never came back to.
--
-- NOTE: separate table from the legacy `questions` log (manual Q&A entries
-- with status open/exploring/answered/dropped). This is auto-mined from
-- chat messages and has a richer answer-detection story.

create table if not exists public.question_graveyard (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  question_text text not null,                       -- verbatim quote ending in ?
  question_kind text not null check (question_kind in (
    'decision','self_inquiry','meta','factual','hypothetical','rhetorical'
  )),
  -- decision      = "should I keep the agency or close it"
  -- self_inquiry  = "why do I keep doing this", "am I really a builder"
  -- meta          = "what's the right way to think about this"
  -- factual       = "how much runway do I have"
  -- hypothetical  = "what if I had said yes back then"
  -- rhetorical    = doesn't actually need an answer (filtered out by needs_answer)
  needs_answer boolean not null default true,        -- false for rhetorical
  domain text not null check (domain in (
    'work','relationships','health','identity','finance','creative','learning','daily','other'
  )),
  asked_date date not null,
  asked_message_id uuid,
  asked_conversation_id uuid,

  topic_aliases jsonb not null default '[]'::jsonb,  -- 1-5 noun phrases tied to the question's topic

  days_since_asked int not null,
  asked_again_count int not null default 0,          -- DISTINCT subsequent messages re-asking the same question
  asked_again_days int not null default 0,

  answered boolean not null default false,
  answer_text text,                                  -- verbatim from message that answered it
  answer_date date,
  answer_message_id uuid,
  days_to_answer int,                                -- null if unanswered
  proposed_answer_excerpts jsonb not null default '[]'::jsonb,  -- [{date, snippet}] up to 3 — possible answers found by Phase 2 regex but not confirmed

  neglect_score smallint not null check (neglect_score between 1 and 5),
  -- 5 = >=90 days unanswered + decision/self_inquiry kind (deeply neglected)
  -- 4 = >=60 days unanswered AND important kind, OR >=120 days any
  -- 3 = >=30 days unanswered
  -- 2 = >=14 days unanswered
  -- 1 = <14 days unanswered (or already answered)

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending','acknowledged','answered','contested','dismissed'
  )),
  status_note text,                                  -- if status=answered, this stores the user's answer
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists question_graveyard_user_recent_idx
  on public.question_graveyard (user_id, asked_date desc);
create index if not exists question_graveyard_user_pending_unanswered_idx
  on public.question_graveyard (user_id, neglect_score desc, asked_date desc)
  where status = 'pending' and answered = false and archived_at is null;
create index if not exists question_graveyard_user_answered_idx
  on public.question_graveyard (user_id, answer_date desc) where answered = true;
create index if not exists question_graveyard_user_pinned_idx
  on public.question_graveyard (user_id, asked_date desc) where pinned = true;
create index if not exists question_graveyard_scan_idx
  on public.question_graveyard (scan_id);

alter table public.question_graveyard enable row level security;

drop policy if exists "question-graveyard-select-own" on public.question_graveyard;
drop policy if exists "question-graveyard-insert-own" on public.question_graveyard;
drop policy if exists "question-graveyard-update-own" on public.question_graveyard;
drop policy if exists "question-graveyard-delete-own" on public.question_graveyard;

create policy "question-graveyard-select-own" on public.question_graveyard
  for select using (auth.uid() = user_id);
create policy "question-graveyard-insert-own" on public.question_graveyard
  for insert with check (auth.uid() = user_id);
create policy "question-graveyard-update-own" on public.question_graveyard
  for update using (auth.uid() = user_id);
create policy "question-graveyard-delete-own" on public.question_graveyard
  for delete using (auth.uid() = user_id);
