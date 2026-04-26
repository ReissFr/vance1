-- §179 — THE GUT-CHECK LEDGER.
--
-- Captures moments the user voiced a gut feeling without articulated
-- reasoning. The "something feels off about this" / "I have a bad feeling
-- about / something tells me / my gut says / I just know / I can't put my
-- finger on it but" — pattern-recognition signals operating below
-- conscious analysis.
--
-- Most thinking tools privilege articulated reasons. Gut signals get
-- dismissed because they don't come with justification. But they ARE data
-- — pattern recognition operating below conscious analysis.
--
-- THE NOVEL DIAGNOSTIC is GUT_ACCURACY_RATE — empirical measurement of
-- how often the user's gut turns out to be right, regardless of whether
-- they followed it. Plus the GUT_TRUST_RATE — how often the outcome was
-- right (followed-and-correct + ignored-and-correct).
--
-- THE NOVEL VISUALISATION is the QUADRANT MATRIX:
--                       Followed gut      Didn't follow
--   Gut was right       VERIFIED_RIGHT    IGNORED_REGRET
--   Gut was wrong       VERIFIED_WRONG    IGNORED_RELIEF
--
-- Distribution across quadrants tells the user empirically whether their
-- gut is reliable, and whether their followthrough on gut signals is
-- well-calibrated. Most people either over-trust or under-trust intuition
-- without ever measuring.
--
-- Six resolutions (plus dismiss + archive + open):
--   verified_right  — gut was right, you followed it. Vindicated.
--   verified_wrong  — gut was wrong, you followed it. Costly.
--   ignored_regret  — didn't follow, gut was right. The "I knew" regret.
--   ignored_relief  — didn't follow, gut was wrong. Glad you didn't.
--   unresolved      — outcome still unfolding (not the same as open;
--                      open = unrecorded outcome; unresolved = recorded
--                      that we are waiting).
--   dismissed       — false positive from the scan.
--   archived        — soft hide.
--   open            — default, awaiting outcome.

create table if not exists public.gut_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid,

  gut_text text not null check (char_length(gut_text) between 4 and 280),
  -- Distilled phrasing of the gut signal in second-person/objective
  -- reference. e.g. "something is off with the new client",
  -- "this deal won't close", "the partnership is going to fall apart",
  -- "this move is the right one", "the project is heading the wrong way".

  signal_kind text not null check (signal_kind in (
    'warning', 'pull', 'suspicion', 'trust',
    'unease', 'certainty', 'dread', 'nudge', 'hunch'
  )),
  -- The flavour of the gut signal:
  --   warning   — "something is wrong / off / dangerous"
  --   pull      — "I'm drawn to this / it feels right"
  --   suspicion — specific distrust of someone/thing
  --   trust     — specific trust of someone/thing without proof
  --   unease    — diffuse discomfort
  --   certainty — "I just know X is going to happen"
  --   dread     — heavy negative anticipation
  --   nudge     — subtle directional pull
  --   hunch     — speculative guess held with conviction

  subject_text text,
  -- Optional 4-160 chars naming what the gut is about. e.g.
  -- "the new investor", "the move to Berlin", "Sarah's pitch",
  -- "this contract", "the second interview".

  domain text not null check (domain in (
    'relationships', 'work', 'money', 'health',
    'decision', 'opportunity', 'risk', 'self', 'unknown'
  )),

  charge smallint not null check (charge between 1 and 5),
  -- 1 = passing nudge
  -- 5 = visceral, can't-shake-it gut signal

  recency text not null check (recency in ('recent', 'older')),
  spoken_date date not null,
  spoken_message_id text not null,
  conversation_id uuid,

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'open' check (status in (
    'open',
    'verified_right', 'verified_wrong',
    'ignored_regret', 'ignored_relief',
    'unresolved',
    'dismissed', 'archived'
  )),
  -- Status carries the QUADRANT classification. The four resolved-with-
  -- outcome states map directly onto the 2x2 matrix (followed gut x gut
  -- was right). 'unresolved' is a deliberate "outcome pending" mark
  -- separate from the default 'open' (which means the user hasn't
  -- recorded any reflection yet). 'dismissed' is for false-positive scan
  -- detections.

  resolution_note text,

  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same gut_text + spoken_message_id never duplicates.
create unique index if not exists gut_checks_user_text_msg_uniq
  on public.gut_checks (user_id, spoken_message_id, gut_text);

create index if not exists gut_checks_user_status_date_idx
  on public.gut_checks (user_id, status, spoken_date desc);

create index if not exists gut_checks_user_open_idx
  on public.gut_checks (user_id, spoken_date desc)
  where status = 'open' and archived_at is null;

create index if not exists gut_checks_user_signal_idx
  on public.gut_checks (user_id, signal_kind, spoken_date desc);

create index if not exists gut_checks_user_domain_idx
  on public.gut_checks (user_id, domain, spoken_date desc);

create index if not exists gut_checks_user_pinned_idx
  on public.gut_checks (user_id, spoken_date desc)
  where pinned = true;

create index if not exists gut_checks_scan_idx
  on public.gut_checks (scan_id);

alter table public.gut_checks enable row level security;

drop policy if exists gut_checks_select_own on public.gut_checks;
create policy gut_checks_select_own on public.gut_checks
  for select using (auth.uid() = user_id);

drop policy if exists gut_checks_insert_own on public.gut_checks;
create policy gut_checks_insert_own on public.gut_checks
  for insert with check (auth.uid() = user_id);

drop policy if exists gut_checks_update_own on public.gut_checks;
create policy gut_checks_update_own on public.gut_checks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists gut_checks_delete_own on public.gut_checks;
create policy gut_checks_delete_own on public.gut_checks
  for delete using (auth.uid() = user_id);

create or replace function public.touch_gut_checks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gut_checks_touch_updated_at on public.gut_checks;
create trigger gut_checks_touch_updated_at
  before update on public.gut_checks
  for each row execute function public.touch_gut_checks_updated_at();
