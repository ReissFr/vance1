-- conversation_loops: detected recurring question/topic threads in the user's
-- chat history with JARVIS.
--
-- Premise: every other journal/productivity tool stores artifacts the user
-- typed. None of them mine the USER'S OWN MESSAGES across hundreds of
-- conversations to surface what they keep circling. Most people loop on the
-- same 3-5 questions for months without seeing it ("should I focus on
-- product or sales", "am I working on the right thing", "is the agency
-- worth keeping"). Conversation loops are the dark matter of indecision.
--
-- The detector scans conversation messages (user-role only) over a window,
-- clusters them by topic+question-shape, and surfaces 0-6 recurring loops
-- the user has been circling. Each loop has a label, a representative
-- question, occurrence count, first/last seen, sample quotes, and an
-- optional candidate resolution path.
--
-- The user can NAME the loop (acknowledge it, often the first step out),
-- RESOLVE it (write the answer or close it as no-longer-loading), CONTEST
-- (the cluster is wrong), or DISMISS (not worth surfacing).

create table if not exists public.conversation_loops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Groups all loops surfaced from one scan run.
  scan_id uuid not null,

  -- Plain-language label of the loop. 3-8 words, headline-cased.
  -- "Should I keep the agency project"
  -- "Am I a builder or operator"
  -- "Is JARVIS worth pursuing as SaaS"
  loop_label text not null,

  -- The canonical question the user keeps asking, in their own voice.
  -- One sentence, lifted/paraphrased from the recurring messages.
  recurring_question text not null,

  -- Plain-language summary of the loop pattern: "you've raised this 14
  -- times across 7 weeks, oscillating between 'commit harder' and 'walk
  -- away'". 2-3 sentences. Names the OSCILLATION shape if there is one.
  pattern_summary text not null,

  -- The domain the loop lives in. Same vocab as patterns.
  domain text not null check (domain in (
    'energy','mood','focus','time','decisions','relationships',
    'work','identity','money','mixed'
  )),

  -- How many distinct conversations the loop appeared in. (Distinct from
  -- raw message count to avoid flooding from one long thread.)
  occurrence_count int not null,

  -- How many distinct calendar days the loop appeared on.
  span_days int not null,

  -- First and last time the loop showed up in the scanned window.
  first_seen_at timestamptz,
  last_seen_at timestamptz,

  -- jsonb array of {date, snippet, conversation_id} — 2-5 dated quotes
  -- from the user's own messages. The receipts.
  sample_quotes jsonb not null default '[]'::jsonb,

  -- Optional path the user might take to step OUT of the loop:
  -- "Run a counter-self chamber against the position 'I should keep the
  -- agency'."
  -- "Set a 14-day decision deadline and write it as a decision."
  -- "Ask: what would have to be true for this question to disappear?"
  -- ONE sentence, observable, ACTIONABLE — not advice.
  candidate_exit text,

  -- 1-5 strength rating. 5 = ironclad load-bearing loop (≥10 occurrences,
  -- ≥4 weeks span), 1 = weak signal worth checking.
  strength smallint not null check (strength between 1 and 5),

  -- User response state.
  user_status text check (user_status in ('named','resolved','contested','dismissed')),
  user_note text,
  -- For 'resolved' state: the user's actual answer to the loop, in their
  -- own voice. min 8 chars when set.
  resolution_text text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  -- Audit
  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create index if not exists conversation_loops_user_recent_idx
  on public.conversation_loops (user_id, created_at desc);

create index if not exists conversation_loops_user_open_idx
  on public.conversation_loops (user_id, strength desc, created_at desc)
  where user_status is null and archived_at is null;

create index if not exists conversation_loops_user_pinned_idx
  on public.conversation_loops (user_id, created_at desc)
  where pinned = true and archived_at is null;

create index if not exists conversation_loops_user_domain_idx
  on public.conversation_loops (user_id, domain, created_at desc);

create index if not exists conversation_loops_scan_idx
  on public.conversation_loops (scan_id);

alter table public.conversation_loops enable row level security;

create policy "conversation_loops_select_own" on public.conversation_loops
  for select using (auth.uid() = user_id);

create policy "conversation_loops_insert_own" on public.conversation_loops
  for insert with check (auth.uid() = user_id);

create policy "conversation_loops_update_own" on public.conversation_loops
  for update using (auth.uid() = user_id);

create policy "conversation_loops_delete_own" on public.conversation_loops
  for delete using (auth.uid() = user_id);
