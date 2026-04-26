-- decision_premortems: failure modes generated for a decision *before* it
-- plays out. Inspired by Daniel Kahneman's pre-mortem technique — assume
-- the decision failed, list the most plausible reasons, then watch for
-- those reasons over time.
--
-- For each decision the user logs, the brain can generate 3-5 plausible
-- failure modes via Haiku (using the decision's title, choice, context,
-- expected_outcome). Each row is one failure mode with a likelihood
-- estimate, a possible mitigation, and a status the user updates as the
-- decision plays out:
--
--   watching   — initial state; the user is keeping an eye on this mode
--   happened   — yes, this failure mode materialised
--   avoided    — the failure mode was averted (mitigation worked)
--   dismissed  — user judged this mode irrelevant
--
-- This makes pre-mortem a living artifact, not a forgotten brainstorm.
-- When the decision is reviewed, the pre-mortem becomes the audit trail.

create table if not exists public.decision_premortems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_id uuid not null references public.decisions(id) on delete cascade,

  failure_mode text not null,
  likelihood smallint not null default 3 check (likelihood between 1 and 5),
  mitigation text,

  status text not null default 'watching'
    check (status in ('watching','happened','avoided','dismissed')),

  resolved_at timestamptz,
  resolved_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decision_premortems_user_status_idx
  on public.decision_premortems (user_id, status, created_at desc);

create index if not exists decision_premortems_decision_idx
  on public.decision_premortems (decision_id, created_at);

alter table public.decision_premortems enable row level security;

create policy "decision_premortems: select own"
  on public.decision_premortems for select
  using (auth.uid() = user_id);

create policy "decision_premortems: insert own"
  on public.decision_premortems for insert
  with check (auth.uid() = user_id);

create policy "decision_premortems: update own"
  on public.decision_premortems for update
  using (auth.uid() = user_id);

create policy "decision_premortems: delete own"
  on public.decision_premortems for delete
  using (auth.uid() = user_id);
