-- Outbound PA: JARVIS places calls on the user's behalf (book a dentist, chase
-- an invoice, confirm a reservation). We store the goal, the full transcript,
-- and whatever outcome Claude extracted at hangup.

create table if not exists public.outbound_calls (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  task_id      uuid references public.tasks(id) on delete set null,
  call_sid     text unique,
  to_e164      text not null,
  -- What we're trying to accomplish. Plain English, passed into Claude's
  -- system prompt.
  goal         text not null,
  -- Optional structured constraints (date window, max price, etc.).
  constraints  jsonb not null default '{}'::jsonb,
  status       text not null default 'queued'
               check (status in ('queued','dialing','in_progress','completed','failed','no_answer')),
  -- Ordered list of {role: 'agent'|'other', text, at}
  turns        jsonb not null default '[]'::jsonb,
  -- Claude-extracted outcome: success/failure, what was booked, next steps.
  outcome      jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz
);
create index if not exists outbound_calls_user_idx on public.outbound_calls(user_id, created_at desc);
create index if not exists outbound_calls_sid_idx  on public.outbound_calls(call_sid);

alter table public.outbound_calls enable row level security;
create policy outbound_calls_owner on public.outbound_calls
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.outbound_calls;
