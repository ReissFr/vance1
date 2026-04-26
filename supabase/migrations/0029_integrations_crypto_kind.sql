-- Allow 'crypto' as an integration kind (Coinbase today; Binance/Kraken later).

alter table public.integrations
  drop constraint if exists integrations_kind_check;

alter table public.integrations
  add constraint integrations_kind_check
  check (kind in ('email','payment','calendar','social','crm','storage','home','banking','concierge_session','crypto'));
