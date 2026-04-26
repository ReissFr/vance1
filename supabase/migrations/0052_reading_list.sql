-- Reading list / read-later queue. Reiss pastes a URL (or asks JARVIS to
-- save one); we fetch the page, Haiku summarizes, and it lands here.

create table if not exists public.reading_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  title text,
  source_domain text,
  summary text,
  note text,
  saved_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz,
  fetch_error text,
  created_at timestamptz not null default now()
);

create index if not exists reading_list_user_saved
  on public.reading_list(user_id, saved_at desc);

create index if not exists reading_list_user_unread
  on public.reading_list(user_id, saved_at desc)
  where read_at is null and archived_at is null;

create unique index if not exists reading_list_user_url_unique
  on public.reading_list(user_id, url);

alter table public.reading_list enable row level security;

create policy "reading_list_user_all"
  on public.reading_list
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
