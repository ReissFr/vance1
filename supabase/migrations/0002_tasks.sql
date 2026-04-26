-- Phase 5: Background task queue.
-- Long-running skills (code_agent, email_triage, etc.) enqueue rows here.
-- A local worker (or server worker for remote-capable tasks) picks them up.

create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid references public.conversations(id) on delete set null,
  kind             text not null,
  status           text not null default 'queued'
                   check (status in ('queued','running','needs_approval','done','failed','cancelled')),
  prompt           text not null,
  args             jsonb not null default '{}'::jsonb,
  result           text,
  error            text,
  device_target    text not null default 'local'
                   check (device_target in ('local','server')),
  input_tokens     integer,
  output_tokens    integer,
  cache_read_tokens integer,
  cost_usd         numeric(10,4),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz
);
create index if not exists tasks_user_idx    on public.tasks(user_id, created_at desc);
create index if not exists tasks_status_idx  on public.tasks(status);
create index if not exists tasks_target_idx  on public.tasks(device_target, status);

create table if not exists public.task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,  -- 'log' | 'tool_use' | 'tool_result' | 'text' | 'progress' | 'error'
  content    text,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events(task_id, created_at);

alter table public.tasks       enable row level security;
alter table public.task_events enable row level security;

create policy tasks_owner       on public.tasks       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy task_events_owner on public.task_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime so the UI can watch live progress.
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.task_events;
