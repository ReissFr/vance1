-- Tracks when JARVIS last proactively nudged the user about a given
-- commitment, so the proactive loop can dedupe and not spam the same
-- promise every tick. Null = never nudged.

alter table public.commitments
  add column if not exists last_nudged_at timestamptz;

create index if not exists commitments_user_due_open_idx
  on public.commitments(user_id, deadline)
  where status = 'open' and deadline is not null;
