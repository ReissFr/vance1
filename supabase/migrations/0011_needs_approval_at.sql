-- When a task pauses for human approval, stamp the moment so the cron poller
-- can find stale ones and escalate (WhatsApp → voice call after N minutes of
-- silence). Without this we'd have to infer timing from task_events strings,
-- which is fragile.

alter table public.tasks
  add column if not exists needs_approval_at timestamptz;

create index if not exists tasks_needs_approval_idx
  on public.tasks(needs_approval_at)
  where status = 'needs_approval';
