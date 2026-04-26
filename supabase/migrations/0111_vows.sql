-- §172 — The Vow Ledger
--
-- A vow is a promise-to-self carried forward from some past moment.
-- Distinct from §167 shoulds (felt obligations from others' voices) and
-- from §169 thresholds (identity-crossings made). A vow was AUTHORED by
-- the user at some past time; the question is whether they still endorse
-- it, and whether the shadow it casts is acceptable.
--
-- The novel diagnostic field is `shadow` — what each vow FORECLOSES.
-- Every "I will always X" implies "I will never not-X". Every "I will
-- never Y" rules out a domain. Most values/commitments tools surface
-- only the positive form ("be strong", "finish what I start"). This
-- ledger forces the cost visible by extracting the shadow alongside the
-- vow itself. The shadow IS the diagnostic.
--
-- The novel resolutions:
--   renew   — "yes this is still mine, I re-author it now"
--   revise  — "the spirit holds but the letter needs updating; here is
--              the new vow" (status_note + revised_to required)
--   release — "I am letting this go; here is what it protected and why
--              I no longer need it" (status_note required)
--   honour  — "I keep it but acknowledge the cost; the shadow is real"
--              (status_note required)
--   dismiss — false alarm / mis-extraction.
--
-- vow_age (childhood/adolescent/early_adult/adult/recent) is captured
-- because vows authored in childhood are often the most load-bearing
-- AND the most likely to be obsolete — the user made the vow at age 7
-- and has been organizing life around it for thirty years without ever
-- re-examining it. Surfacing the age IS the move toward re-authorship.

create table if not exists public.vows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null default gen_random_uuid(),

  -- The named vow
  vow_text text not null check (length(vow_text) between 4 and 240),

  -- The shadow — what this vow rules out / forecloses (the cost)
  shadow text not null check (length(shadow) between 4 and 280),

  -- Optional origin event the user mentioned ("after my dad left", "after
  -- the bankruptcy", "since the breakdown")
  origin_event text check (origin_event is null or length(origin_event) between 4 and 240),

  vow_age text not null check (vow_age in ('childhood','adolescent','early_adult','adult','recent','unknown')),

  domain text not null check (domain in (
    'work','health','relationships','family','finance','creative','self','spiritual','other'
  )),

  -- 1=passing rule, 5=organizing principle of life
  weight smallint not null check (weight between 1 and 5),
  recency text not null check (recency in ('recent','older')),

  confidence smallint not null check (confidence between 1 and 5),
  spoken_date date not null,
  spoken_message_id text,
  conversation_id uuid,

  -- Resolution
  status text not null check (status in ('active','renewed','revised','released','honoured','dismissed')) default 'active',
  status_note text,
  revised_to text check (revised_to is null or length(revised_to) between 4 and 240),
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  -- Audit
  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vows_user_msg_unique
  on public.vows (user_id, spoken_message_id)
  where spoken_message_id is not null;

create index if not exists vows_user_date
  on public.vows (user_id, spoken_date desc, weight desc);

create index if not exists vows_user_active
  on public.vows (user_id, weight desc, spoken_date desc)
  where status = 'active' and archived_at is null;

create index if not exists vows_user_age
  on public.vows (user_id, vow_age, weight desc);

create index if not exists vows_user_domain
  on public.vows (user_id, domain, spoken_date desc);

create index if not exists vows_user_pinned
  on public.vows (user_id, spoken_date desc)
  where pinned = true and archived_at is null;

create index if not exists vows_scan
  on public.vows (scan_id);

alter table public.vows enable row level security;

create policy "vows_select_own"
  on public.vows for select
  using (auth.uid() = user_id);

create policy "vows_insert_own"
  on public.vows for insert
  with check (auth.uid() = user_id);

create policy "vows_update_own"
  on public.vows for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "vows_delete_own"
  on public.vows for delete
  using (auth.uid() = user_id);
