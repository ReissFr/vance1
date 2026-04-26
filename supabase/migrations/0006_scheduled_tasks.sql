-- Phase 6: Scheduled tasks for the ops_agent.
-- A task with scheduled_at in the future stays in status='queued' but isn't
-- triggered immediately. A polling cron job picks them up when the time
-- arrives and routes them to the matching runner (or fires the reminder
-- directly for kind='reminder').

alter table public.tasks
  add column if not exists scheduled_at timestamptz;

create index if not exists tasks_scheduled_idx
  on public.tasks(scheduled_at)
  where status = 'queued' and scheduled_at is not null;
