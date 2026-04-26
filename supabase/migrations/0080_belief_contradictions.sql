-- belief_contradictions: structured stance-flip pairs the brain spots
-- between the user's stated identity (especially `value` and `refuse`
-- claims) and what they're actually doing (decisions / standups / wins
-- / reflections / intentions / check-ins).
--
-- Why this works:
--   The user has two streams of writing — what they believe (identity
--   claims) and what they live (everything else). When those drift, it
--   matters. This table captures the diff as concrete pairs the user
--   can look at and decide whether they've changed their mind, whether
--   the slip was a one-off, or whether the stated belief is still true
--   and they need to course-correct.
--
-- Each contradiction is a JOIN between one identity_claim and one
-- evidence row from any of the supported source kinds, with a Haiku-
-- written note explaining the conflict and a severity (1=mild drift,
-- 5=outright contradiction). Status flow: open → one of four
-- resolutions. Once resolved, never auto-reopened (but a fresh scan can
-- find a new pair against the same claim if behaviour keeps drifting).
--
-- Resolutions:
--   resolved_changed_mind  — the belief is no longer true; user retires
--     or rewrites the identity claim
--   resolved_still_true    — the belief still holds; user commits to
--     re-aligning behaviour
--   resolved_one_off       — slip was an exception, not a pattern
--   dismissed              — model was wrong; this isn't a real
--     contradiction
--
-- We do NOT enforce uniqueness on (claim_id, evidence_kind, evidence_id)
-- because the same pair could surface across multiple scans before the
-- user gets to it; instead the scan route checks for an existing OPEN
-- pair before inserting, so we never duplicate active rows.

create table if not exists public.belief_contradictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Snapshot of the identity claim at scan time (claim_id is FK; the
  -- text/kind copies survive even if the claim is later edited).
  claim_id uuid not null references public.identity_claims(id) on delete cascade,
  claim_kind text not null
    check (claim_kind in ('am','value','refuse','becoming','aspire')),
  claim_text text not null,

  -- Evidence row that conflicts with the claim. evidence_kind names the
  -- source table; evidence_id points into it. We deliberately do NOT
  -- foreign-key these (decisions/standups/wins/reflections/intentions/
  -- daily_checkins are different tables), so we copy a text excerpt and
  -- date for stable display even if the source row is later edited.
  evidence_kind text not null
    check (evidence_kind in ('decision','standup','win','reflection','intention','checkin')),
  evidence_id uuid not null,
  evidence_text text not null,
  evidence_date date not null,

  severity smallint not null default 3
    check (severity between 1 and 5),
  note text,

  status text not null default 'open'
    check (status in ('open','resolved_changed_mind','resolved_still_true','resolved_one_off','dismissed')),

  resolved_at timestamptz,
  resolved_note text,

  -- The window the scan ran over, for context.
  scan_window_days smallint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists belief_contradictions_user_open_idx
  on public.belief_contradictions (user_id, severity desc, created_at desc)
  where status = 'open';

create index if not exists belief_contradictions_user_recent_idx
  on public.belief_contradictions (user_id, created_at desc);

create index if not exists belief_contradictions_claim_idx
  on public.belief_contradictions (claim_id, status);

alter table public.belief_contradictions enable row level security;

create policy "belief_contradictions: select own"
  on public.belief_contradictions for select
  using (auth.uid() = user_id);

create policy "belief_contradictions: insert own"
  on public.belief_contradictions for insert
  with check (auth.uid() = user_id);

create policy "belief_contradictions: update own"
  on public.belief_contradictions for update
  using (auth.uid() = user_id);

create policy "belief_contradictions: delete own"
  on public.belief_contradictions for delete
  using (auth.uid() = user_id);
