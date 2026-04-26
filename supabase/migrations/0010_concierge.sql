-- Concierge agent session storage + autonomous-booking spend limit.
--
-- concierge_session rows hold a captured Playwright storageState (cookies +
-- localStorage) per site the user has logged into for the concierge. Multiple
-- active rows per user are required (one per site), so we replace the single
-- "at most one active per kind" constraint with two partial indexes: the
-- original for normal capability kinds, a looser one for concierge_session.

alter table public.integrations drop constraint if exists integrations_kind_check;
alter table public.integrations add constraint integrations_kind_check
  check (kind in ('email','payment','calendar','social','crm','storage','home','banking','concierge_session'));

drop index if exists integrations_one_active_per_kind;

create unique index integrations_one_active_per_kind
  on public.integrations(user_id, kind)
  where active and kind <> 'concierge_session';

create unique index integrations_concierge_one_per_site
  on public.integrations(user_id, kind, provider)
  where active and kind = 'concierge_session';

alter table public.profiles
  add column if not exists concierge_auto_limit_gbp numeric(10,2) not null default 0;
