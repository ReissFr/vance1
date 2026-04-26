-- §182 — VENTURES AUTONOMY (the CEO mode actually-runs-it layer)
--
-- 0120 stood up the data model, decision-tier classifier, and "auto_executed"
-- status — but auto_executed was just a STAMP. Nothing actually executed.
-- This migration adds the substrate to make CEO mode genuinely autonomous:
--
--   1. ventures.autonomy — per-venture toggle that controls how the operator
--      loop dispatches each tier:
--        manual         — every decision queues, even auto-tier (review-only)
--        supervised     — auto+notify execute via brain start_errand,
--                         approve still queues
--        autonomous     — same as supervised + the heartbeat itself runs
--                         on schedule without human nudge (default)
--        full_autopilot — auto, notify AND approve all dispatch through
--                         start_errand. Only kill/pivot/contract still gate.
--      Default = 'supervised' so a user has to deliberately escalate trust.
--
--   2. ventures.paused_at — distinct from status='paused'. Pausing temporarily
--      halts the heartbeat without losing the underlying status (e.g. you
--      can pause a 'launched' venture for the holidays without re-categorising
--      it). Resume = clear paused_at.
--
--   3. venture_decisions.execution_task_id + execution_status —
--      when the operator loop dispatches a decision via start_errand it gets
--      back a tasks.id; we link them so the venture detail page can show
--      "running / done / failed" against each silently-executed decision and
--      the user can click through to the task detail.
--
--   4. venture_decisions.actual_spend_pence — the loop estimates spend at
--      proposal time but the errand reports actual spend. We backfill this
--      from the executed task so budget enforcement is precise.
--
--   5. profiles.ventures_panic_stop_at + ventures_panic_stop_reason —
--      GLOBAL kill switch. When set, the cron poller skips ALL ventures
--      for this user, regardless of per-venture autonomy. One button stops
--      everything. Also blocks dispatch inside operator-loop in case a
--      heartbeat is mid-flight.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. ventures.autonomy + paused_at
-- ─────────────────────────────────────────────────────────────────────────

alter table public.ventures
  add column if not exists autonomy text not null default 'supervised'
    check (autonomy in ('manual', 'supervised', 'autonomous', 'full_autopilot'));

alter table public.ventures
  add column if not exists paused_at timestamptz;

-- The existing ventures_due_heartbeat_idx already excludes status='paused';
-- we want to also exclude paused_at-set rows from the cron sweep without
-- mutating status. Replace the partial-index predicate.
drop index if exists public.ventures_due_heartbeat_idx;
create index if not exists ventures_due_heartbeat_idx
  on public.ventures (next_heartbeat_at)
  where status not in ('paused', 'killed')
    and paused_at is null
    and next_heartbeat_at is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. venture_decisions.execution_task_id + execution_status + actual_spend
-- ─────────────────────────────────────────────────────────────────────────

alter table public.venture_decisions
  add column if not exists execution_task_id uuid
    references public.tasks(id) on delete set null;

alter table public.venture_decisions
  add column if not exists execution_status text
    check (execution_status in (
      'pending', 'running', 'succeeded', 'failed', 'blocked', 'cancelled'
    ));

alter table public.venture_decisions
  add column if not exists actual_spend_pence bigint not null default 0
    check (actual_spend_pence >= 0);

create index if not exists venture_decisions_exec_status_idx
  on public.venture_decisions (venture_id, execution_status, created_at desc)
  where execution_status is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. profiles.ventures_panic_stop_at + reason — the global kill switch
-- ─────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists ventures_panic_stop_at timestamptz;

alter table public.profiles
  add column if not exists ventures_panic_stop_reason text;
