-- Crypto whitelist addresses — the ONLY destinations JARVIS is allowed to
-- send funds to. Prompt-injection defence: a hostile email/web page cannot
-- exfil crypto by convincing the brain to paste an address, because raw
-- addresses are refused and only labels the user has pre-approved resolve
-- to real destinations.
--
-- Shape:
--   label       = user-chosen handle ("mum", "hardware wallet"). Unique per user.
--   asset       = ticker this address is valid for ("BTC", "ETH", "USDC").
--   network     = network/chain hint ("bitcoin", "ethereum", "base", ...).
--                 Optional for providers that don't require it.
--   address     = actual on-chain address or email-for-coinbase-send.
--   provider    = null = any provider, or "coinbase"/"kraken" if tied to one
--                 (Kraken withdrawals require the label pre-registered on
--                 kraken.com, so provider='kraken' also implies the label
--                 matches the Kraken-side registration).
--   verified_at = when the user confirmed adding it via WhatsApp approval.
--                 Rows without verified_at are not usable for sends.

create table if not exists public.crypto_whitelist_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text not null,
  asset        text not null,
  network      text,
  address      text not null,
  provider     text,
  verified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, label)
);

create index if not exists crypto_whitelist_user_idx
  on public.crypto_whitelist_addresses(user_id);

alter table public.crypto_whitelist_addresses enable row level security;

create policy crypto_whitelist_owner on public.crypto_whitelist_addresses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
