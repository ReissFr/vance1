-- Autopilot: user hands JARVIS a goal, JARVIS takes the machine and executes
-- end-to-end. One row per run, with a live-updating steps jsonb the UI watches
-- via Realtime. Kill switch is a status flip the runner polls between rounds.

create table if not exists public.autopilot_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  goal          text not null,
  status        text not null default 'queued'
                check (status in ('queued','planning','running','cancelled','done','failed')),
  -- Live-updated feed of everything the brain is doing. The UI watches this
  -- via Realtime and renders each entry as a row in the "watch it drive"
  -- feed. Shape: [{ at, type: 'text'|'tool_use'|'tool_result', ... }]
  steps         jsonb not null default '[]'::jsonb,
  result        text,
  error         text,
  -- Token usage aggregated across all rounds so we can show cost per run.
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists autopilot_runs_user_idx
  on public.autopilot_runs(user_id, created_at desc);
create index if not exists autopilot_runs_status_idx
  on public.autopilot_runs(status)
  where status in ('queued','planning','running');

alter table public.autopilot_runs enable row level security;
create policy autopilot_runs_owner on public.autopilot_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.autopilot_runs;
