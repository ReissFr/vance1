-- Phase 5.1: Outbound notifications (SMS + voice calls) and inbound SMS replies.
-- Vance reaches the user on their phone when something finishes, needs approval,
-- or is urgent. Powered by Twilio.

-- 1. Add the user's mobile number to their profile.
alter table public.profiles
  add column if not exists mobile_e164 text;

-- 2. Outbound notifications log — every SMS we send and every call we place.
create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  task_id        uuid references public.tasks(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  channel        text not null check (channel in ('sms','call')),
  to_e164        text not null,
  body           text not null,
  -- Twilio handles: MessageSid for SMS, CallSid for calls.
  provider_sid   text,
  status         text not null default 'queued'
                 check (status in ('queued','sent','delivered','failed','in_progress','completed','no_answer','busy','cancelled')),
  error          text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index if not exists notifications_user_idx    on public.notifications(user_id, created_at desc);
create index if not exists notifications_task_idx    on public.notifications(task_id);
create index if not exists notifications_sid_idx     on public.notifications(provider_sid);

-- 3. Inbound SMS replies from the user. Also used to look up what outbound message
--    the user is replying to (Twilio doesn't thread, so we match by time + sender).
create table if not exists public.inbound_messages (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  channel        text not null check (channel in ('sms','call')),
  from_e164      text not null,
  body           text,
  provider_sid   text,
  -- If we auto-replied via the brain, link the reply notification.
  reply_notification_id uuid references public.notifications(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists inbound_messages_user_idx on public.inbound_messages(user_id, created_at desc);

alter table public.notifications    enable row level security;
alter table public.inbound_messages enable row level security;

create policy notifications_owner    on public.notifications    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy inbound_messages_owner on public.inbound_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime so the UI can flash incoming replies / delivery status.
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.inbound_messages;
