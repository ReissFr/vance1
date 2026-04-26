-- Extend integrations.kind to include tasks (Linear, Todoist),
-- transactional (Resend, future Mailgun/SendGrid), files (Google Drive,
-- future Dropbox/OneDrive). Same single-column-check pattern as prior
-- migrations — the whole list is restated.

alter table public.integrations
  drop constraint if exists integrations_kind_check;

alter table public.integrations
  add constraint integrations_kind_check
  check (kind in (
    'email',
    'payment',
    'calendar',
    'social',
    'crm',
    'storage',
    'home',
    'banking',
    'concierge_session',
    'crypto',
    'commerce',
    'accounting',
    'productivity',
    'dev',
    'messaging',
    'tasks',
    'transactional',
    'files'
  ));
