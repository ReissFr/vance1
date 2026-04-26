-- 0041_telegram_link.sql — one-shot codes to link a Telegram chat_id to a
-- JARVIS user. The shared bot's webhook consumes the code on /start <code>
-- and stores the resulting (chat_id, user_id) mapping in integrations
-- (kind=messaging, provider=telegram).

create table if not exists public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz
);

create index if not exists telegram_link_codes_user_idx
  on public.telegram_link_codes (user_id, created_at desc);

alter table public.telegram_link_codes enable row level security;

create policy telegram_link_codes_own_read
  on public.telegram_link_codes for select
  using (auth.uid() = user_id);

create policy telegram_link_codes_own_insert
  on public.telegram_link_codes for insert
  with check (auth.uid() = user_id);
