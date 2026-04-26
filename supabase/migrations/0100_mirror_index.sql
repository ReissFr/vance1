-- §161 Mirror Index
--
-- Each row is a moment the user compared themselves to someone or something.
-- Six kinds of comparison:
--   past_self     — "when I was 25 I would have", "old me", "I used to be"
--   peer          — "X has a startup and 3 kids", "everyone else seems to"
--   sibling_or_parent — "my brother built X by 30", "my dad would have"
--   ideal_self    — "I should be the kind of person who", "someone who has it together"
--   imagined_future_self — "I want to be the kind of person who"
--   downward      — "at least I'm not", "could be worse", "imagine being them"
--
-- Each comparison records WHO/WHAT they compared themselves to (target),
-- WHERE they put themselves on the comparison (self_position: below /
-- equal / above / aspiring), the FAIRNESS of the comparison (1-5, where
-- 1 = cruel/distorted self-comparison and 5 = fair/honest accounting),
-- and the VALENCE (positive/neutral/negative — does the comparison lift
-- the user or punish them).
--
-- Phase 2 (deterministic) tracks RECURRENCE of the same comparison target
-- — e.g. "you have compared yourself to your brother 14 times in 90 days,
-- always in the below position, always with a fairness <=2". That's the
-- load-bearing pattern: not the individual comparison but the topology of
-- WHO the user keeps measuring themselves against and HOW unfairly they do
-- it. No therapy/journaling/productivity app surfaces comparison-as-
-- cognitive-pattern.

create table if not exists public.mirror_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  comparison_text text not null,                       -- verbatim quote ≤320 chars
  comparison_kind text not null check (comparison_kind in (
    'past_self','peer','sibling_or_parent','ideal_self','imagined_future_self','downward'
  )),
  comparison_target text not null,                     -- 1-5 word noun phrase: "my brother", "old me at 23", "founders my age", "the version of me who exercises"
  target_aliases jsonb not null default '[]'::jsonb,   -- 1-5 aliases the user might use to refer to the same target

  self_position text not null check (self_position in (
    'below','equal','above','aspiring'
  )),
  -- below     = user places themselves beneath the comparison
  -- equal     = user reads themselves as roughly matched (rare)
  -- above     = user reads themselves as ahead (rare for upward kinds)
  -- aspiring  = user is reaching toward the comparison (typical for ideal/future)

  fairness_score smallint not null check (fairness_score between 1 and 5),
  -- 5 = fair, honest accounting (acknowledges differences in starting points / circumstances / luck)
  -- 4 = mostly fair
  -- 3 = neutral / hard to tell
  -- 2 = unfair, ignores major asymmetries in resources/timing/luck
  -- 1 = cruel, distorted, comparing apples to oranges in service of self-criticism

  valence text not null check (valence in (
    'lifting','neutral','punishing'
  )),
  -- lifting   = comparison ends with motivation/grace/curiosity ('I admire X and want to learn from them')
  -- neutral   = factual/observational
  -- punishing = comparison ends with self-attack ('they did this and I haven't, I'm so behind')

  domain text not null check (domain in (
    'work','relationships','health','identity','finance','creative','learning','daily','other'
  )),
  spoken_date date not null,
  spoken_message_id uuid,
  spoken_conversation_id uuid,

  recurrence_count int not null default 1,             -- DISTINCT messages mentioning the same target across the window (including this one)
  recurrence_days int not null default 1,              -- DISTINCT calendar days with mentions
  recurrence_samples jsonb not null default '[]'::jsonb,  -- [{date, snippet}] up to 5 recent prior comparisons against the same target

  pattern_severity smallint not null check (pattern_severity between 1 and 5),
  -- 5 = recurrence ≥10 with mostly-below self_position and avg fairness <=2 (a chronic punishing comparison)
  -- 4 = recurrence ≥6 with same shape
  -- 3 = recurrence ≥3 with negative valence
  -- 2 = recurrence ≥3 mixed
  -- 1 = isolated comparison

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending','acknowledged','contested','reframed','dismissed'
  )),
  -- reframed = user wrote a fair/lifting reframe of the comparison; status_note stores the reframe
  status_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists mirror_comparisons_user_recent_idx
  on public.mirror_comparisons (user_id, spoken_date desc);
create index if not exists mirror_comparisons_user_pending_severity_idx
  on public.mirror_comparisons (user_id, pattern_severity desc, spoken_date desc)
  where status = 'pending' and archived_at is null;
create index if not exists mirror_comparisons_user_target_idx
  on public.mirror_comparisons (user_id, comparison_target, spoken_date desc);
create index if not exists mirror_comparisons_user_pinned_idx
  on public.mirror_comparisons (user_id, spoken_date desc) where pinned = true;
create index if not exists mirror_comparisons_scan_idx
  on public.mirror_comparisons (scan_id);

alter table public.mirror_comparisons enable row level security;

drop policy if exists "mirror-comparisons-select-own" on public.mirror_comparisons;
drop policy if exists "mirror-comparisons-insert-own" on public.mirror_comparisons;
drop policy if exists "mirror-comparisons-update-own" on public.mirror_comparisons;
drop policy if exists "mirror-comparisons-delete-own" on public.mirror_comparisons;

create policy "mirror-comparisons-select-own" on public.mirror_comparisons
  for select using (auth.uid() = user_id);
create policy "mirror-comparisons-insert-own" on public.mirror_comparisons
  for insert with check (auth.uid() = user_id);
create policy "mirror-comparisons-update-own" on public.mirror_comparisons
  for update using (auth.uid() = user_id);
create policy "mirror-comparisons-delete-own" on public.mirror_comparisons
  for delete using (auth.uid() = user_id);
