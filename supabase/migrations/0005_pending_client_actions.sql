-- Phase 5.3: queue of device actions the brain wants the user's desktop app to
-- execute. Used when the brain runs in a non-interactive context (e.g. WhatsApp
-- inbound) and the desktop app acts as the executor.

create table if not exists public.pending_client_actions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid references public.conversations(id) on delete set null,
  source           text not null default 'whatsapp',      -- 'whatsapp' | 'web' | ...
  notify_channel   text check (notify_channel in ('whatsapp','sms','call')),
  notify_to_e164   text,                                  -- where to send the result back
  tool_name        text not null,
  tool_args        jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                   check (status in ('pending','running','completed','failed','expired')),
  result           jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz
);
create index if not exists pending_client_actions_user_status_idx
  on public.pending_client_actions(user_id, status, created_at);

alter table public.pending_client_actions enable row level security;

create policy pending_client_actions_owner
  on public.pending_client_actions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.pending_client_actions;
