-- Inbound PA: when a caller's forwarded to our Twilio number, the PA answers,
-- takes a message across a multi-turn speech conversation, and stores the
-- transcript + summary here. A post-call hook pings the user on WhatsApp.

create table if not exists public.voice_calls (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  call_sid     text not null unique,
  from_e164    text not null,
  to_e164      text not null,
  status       text not null default 'in_progress'
               check (status in ('in_progress','completed','failed','no_input')),
  -- Ordered list of {role: 'caller'|'agent', text, at}
  turns        jsonb not null default '[]'::jsonb,
  -- Extracted at end of call by the same Claude pass that decides to hang up.
  caller_name  text,
  purpose      text,
  urgency      text check (urgency in ('low','normal','high')),
  summary      text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists voice_calls_user_idx on public.voice_calls(user_id, created_at desc);
create index if not exists voice_calls_sid_idx  on public.voice_calls(call_sid);

alter table public.voice_calls enable row level security;
create policy voice_calls_owner on public.voice_calls
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.voice_calls;
