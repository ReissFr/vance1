-- Opaque token for the user's iCal subscription feed of open commitments.
-- Exposed via a URL like /api/commitments/feed.ics?token=<token> so calendar
-- apps (Google, Apple) can subscribe without cookie-based auth.
--
-- Generated lazily on first request to /api/commitments/feed-info.

alter table public.profiles
  add column if not exists ics_token text;

create unique index if not exists profiles_ics_token_unique
  on public.profiles(ics_token)
  where ics_token is not null;
