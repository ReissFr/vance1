-- Extend integrations.kind to allow 'home' for smart-home providers
-- (SmartThings for Samsung TVs/appliances; Google Home, HomeKit, Home
-- Assistant as future providers).

alter table public.integrations
  drop constraint if exists integrations_kind_check;

alter table public.integrations
  add constraint integrations_kind_check
  check (kind in ('email','payment','calendar','social','crm','storage','home'));
