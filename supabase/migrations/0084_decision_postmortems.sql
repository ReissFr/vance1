-- decision_postmortems: scheduled "did this play out?" check-ins for any
-- decision the user has logged. Each row is one check-in at a defined offset
-- from the decision (1w, 1mo, 3mo, 6mo, 1y, custom). The cron poller fires
-- the check-in via WhatsApp; the user's response captures the actual outcome
-- and a 1-5 outcome_match score (how closely reality tracked the prediction).
--
-- Aggregating outcome_match across many decisions becomes a calibration
-- signal — the user can see their predictive accuracy over time per tag /
-- per decision-class, similar to a forecaster's Brier score.

create table if not exists public.decision_postmortems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_id uuid not null references public.decisions(id) on delete cascade,

  due_at timestamptz not null,
  scheduled_offset text,

  fired_at timestamptz,
  fired_via text check (fired_via in ('whatsapp','web','manual')),

  responded_at timestamptz,
  actual_outcome text,
  outcome_match smallint check (outcome_match between 1 and 5),
  surprise_note text,
  lesson text,
  verdict text check (verdict in ('right_call','wrong_call','mixed','too_early','unclear')),

  cancelled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decision_postmortems_user_due_idx
  on public.decision_postmortems (user_id, due_at)
  where responded_at is null and cancelled_at is null;

create index if not exists decision_postmortems_due_global_idx
  on public.decision_postmortems (due_at)
  where responded_at is null and cancelled_at is null and fired_at is null;

create index if not exists decision_postmortems_decision_idx
  on public.decision_postmortems (decision_id, due_at);

create index if not exists decision_postmortems_user_responded_idx
  on public.decision_postmortems (user_id, responded_at desc)
  where responded_at is not null;

alter table public.decision_postmortems enable row level security;

create policy "decision_postmortems_select_own" on public.decision_postmortems
  for select using (auth.uid() = user_id);

create policy "decision_postmortems_insert_own" on public.decision_postmortems
  for insert with check (auth.uid() = user_id);

create policy "decision_postmortems_update_own" on public.decision_postmortems
  for update using (auth.uid() = user_id);

create policy "decision_postmortems_delete_own" on public.decision_postmortems
  for delete using (auth.uid() = user_id);
