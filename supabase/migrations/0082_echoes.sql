-- Echo Journal — semantic-conceptual recall of "you've felt this before".
--
-- When the user writes a reflection, makes a decision, or jots a non-empty
-- daily check-in note, JARVIS can scan their prior entries (typically the
-- last 365 days, excluding the source itself and a small recency window
-- around it) and surface the conceptually closest matches: not keyword
-- matches but pattern matches — same emotional loop, same recurring
-- frustration, same insight in different words.
--
-- Each echo is a one-way relation FROM a recent source entry TO an older
-- match entry. We store an excerpt + date snapshot of both sides so the
-- echo card stays readable even if the user later edits the source rows.
-- Severity (1=loose / 5=near-identical) and a one-line similarity_note
-- are produced by the model and validated server-side.

create table if not exists public.echoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  source_kind text not null check (source_kind in ('reflection', 'decision', 'daily_checkin')),
  source_id uuid not null,
  source_text_excerpt text not null,
  source_date date not null,

  match_kind text not null check (match_kind in ('reflection', 'decision', 'daily_checkin')),
  match_id uuid not null,
  match_text_excerpt text not null,
  match_date date not null,

  similarity smallint not null check (similarity between 1 and 5),
  similarity_note text not null,

  user_note text,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Open echoes for a user, sorted by recent source first, then by similarity.
create index if not exists echoes_user_open_idx
  on public.echoes (user_id, source_date desc, similarity desc)
  where dismissed_at is null;

-- For "show me echoes of this specific entry".
create index if not exists echoes_user_source_idx
  on public.echoes (user_id, source_kind, source_id, similarity desc);

-- Helps the dedup-on-scan check ("is there already an echo for this exact pair").
create unique index if not exists echoes_user_pair_uniq
  on public.echoes (user_id, source_kind, source_id, match_kind, match_id);

alter table public.echoes enable row level security;

create policy echoes_select_own on public.echoes for select to authenticated using (auth.uid() = user_id);
create policy echoes_insert_own on public.echoes for insert to authenticated with check (auth.uid() = user_id);
create policy echoes_update_own on public.echoes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy echoes_delete_own on public.echoes for delete to authenticated using (auth.uid() = user_id);
