-- Add 'commerce' (Shopify, BigCommerce) and 'accounting' (Xero, QuickBooks,
-- FreeAgent) to the list of allowed integration kinds.

alter table public.integrations
  drop constraint if exists integrations_kind_check;

alter table public.integrations
  add constraint integrations_kind_check
  check (kind in (
    'email','payment','calendar','social','crm','storage','home','banking',
    'concierge_session','crypto','commerce','accounting'
  ));
