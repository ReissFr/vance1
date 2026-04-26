-- Add 'productivity' (Notion), 'dev' (GitHub), and 'messaging' (Slack) to
-- the list of allowed integration kinds. Cal.com reuses the existing
-- 'calendar' kind.

alter table public.integrations
  drop constraint if exists integrations_kind_check;

alter table public.integrations
  add constraint integrations_kind_check
  check (kind in (
    'email','payment','calendar','social','crm','storage','home','banking',
    'concierge_session','crypto','commerce','accounting',
    'productivity','dev','messaging'
  ));
