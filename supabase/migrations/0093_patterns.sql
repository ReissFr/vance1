-- patterns: causal pattern library — cross-event statistical/narrative patterns
-- found in the user's own logs.
--
-- Every other journal/productivity tool stores artifacts. None of them tell
-- the user "X causes Y in YOUR life specifically." The pattern library scans
-- across daily_checkins / standups / intentions / decisions / reflections /
-- wins / habit_logs / blockers / focus_sessions and surfaces statistically
-- meaningful cause-effect patterns the user lives inside without seeing —
-- "late nights (after 23:00 standups, blockers mentioning sleep) precede
-- next-day energy drops in 11 of 14 cases", "decisions logged on low-mood
-- days are reversed within 4 weeks 80% of the time", "wins concentrate on
-- Tuesdays and Wednesdays".
--
-- The user can CONFIRM (yes I see it now), CONTEST (the pattern is spurious),
-- or DISMISS (signal isn't useful). Confirmed patterns can be pinned so the
-- brain references them in future planning conversations.

create table if not exists public.patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Groups all patterns surfaced from one scan run, useful for forensics
  -- and "show me everything that came out of last week's scan".
  scan_id uuid not null,

  -- The shape of the pattern. correlation: A and B co-occur above chance.
  -- sequence: A precedes B (temporal). cluster: A clusters with X/Y/Z.
  -- threshold: A above threshold N predicts B. compound: combined signals
  -- predict B.
  relation_kind text not null check (relation_kind in (
    'correlation', 'sequence', 'cluster', 'threshold', 'compound'
  )),

  -- Plain-language statement of the antecedent ("Late check-ins after 23:00").
  -- 4-12 words, present tense, observable.
  antecedent text not null,
  -- Plain-language statement of the consequent ("Next-day energy drops below 3").
  -- 4-12 words, present tense, observable.
  consequent text not null,

  -- ONE-sentence framing of the whole pattern in second-person — meant to
  -- LAND. "When you log late nights, your next-day energy drops in 4 out
  -- of 5 cases."
  statement text not null,

  -- Optional second-sentence elaboration / context / counterexample. Empty
  -- if not needed.
  nuance text,

  -- The data domain this pattern lives in: energy / mood / focus / time /
  -- decisions / relationships / work / habits / money / mixed.
  domain text not null check (domain in (
    'energy','mood','focus','time','decisions','relationships',
    'work','habits','money','mixed'
  )),

  -- Direction: positive (A increases B) or negative (A decreases B) or
  -- neither (categorical co-occurrence).
  direction text not null default 'neither' check (direction in (
    'positive','negative','neither'
  )),

  -- Quantified strength of the pattern. lift > 1 = above-chance, < 1 = below
  -- chance. Stored as numeric for precision. NULL for narrative-only patterns.
  lift numeric(5,2),

  -- How many supporting cases (e.g. "11 of 14"). Whole number.
  support_count int,
  -- Total cases in the relevant window (the denominator of support_count).
  total_count int,

  -- 1-5 strength rating. 5 = ironclad pattern, 4 = strong, 3 = noticeable,
  -- 2 = weak signal, 1 = noise-floor curiosity.
  strength smallint not null check (strength between 1 and 5),

  -- Source signals naming the data feeds that produced it. Free text.
  source_signal text,

  -- jsonb array of {date, antecedent_evidence, consequent_evidence}.
  -- 2-5 examples max — the receipts.
  examples jsonb not null default '[]'::jsonb,

  -- Optional candidate intervention: "If you want fewer reversed decisions,
  -- avoid logging them on low-mood days." ONE sentence, observable.
  -- Distinct from advice — frames the user's own pattern as a lever they can
  -- pull or not.
  candidate_intervention text,

  -- User response state.
  user_status text check (user_status in ('confirmed','contested','dismissed')),
  user_note text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  -- Audit
  latency_ms int,
  model text,

  created_at timestamptz not null default now()
);

create index if not exists patterns_user_recent_idx
  on public.patterns (user_id, created_at desc);

create index if not exists patterns_user_open_idx
  on public.patterns (user_id, strength desc, created_at desc)
  where user_status is null and archived_at is null;

create index if not exists patterns_user_pinned_idx
  on public.patterns (user_id, created_at desc)
  where pinned = true and archived_at is null;

create index if not exists patterns_user_domain_idx
  on public.patterns (user_id, domain, created_at desc);

create index if not exists patterns_scan_idx
  on public.patterns (scan_id);

alter table public.patterns enable row level security;

create policy "patterns_select_own" on public.patterns
  for select using (auth.uid() = user_id);

create policy "patterns_insert_own" on public.patterns
  for insert with check (auth.uid() = user_id);

create policy "patterns_update_own" on public.patterns
  for update using (auth.uid() = user_id);

create policy "patterns_delete_own" on public.patterns
  for delete using (auth.uid() = user_id);
