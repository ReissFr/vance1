-- §180 — THE FEAR LEDGER.
--
-- Captures the moments the user voiced a fear: "I'm afraid that / I worry
-- that / what if X / it scares me that / I keep having this fear / it terrifies
-- me that / my biggest fear is / I'm scared of". Each fear has a feared
-- event/outcome stated as a CLAIM about the future.
--
-- THE NOVEL DIAGNOSTIC is FEAR_REALISATION_RATE — empirical measurement of
-- how often the user's fears actually came true. Plus the FEAR_OVERRUN_RATE
-- — how much cognitive bandwidth was spent on fears that dissolved without
-- happening. Most people have no idea what their personal rate is. They
-- carry every fear at full charge because they never measure.
--
-- Pairs with §179 gut-checks. Together: empirical view of the inner alarm
-- system. The user finds out that their gut is reliable on PEOPLE-WARNING
-- signals (78% accuracy) but their MONEY-CATASTROPHISING fears almost never
-- come true (8% realisation). That is real self-knowledge that no other
-- tool gives.
--
-- THE NOVEL VISUALISATION is the FEAR-VS-REALITY MAP — a per-fear-kind
-- breakdown of realisation rate, plus the diagnostic line:
--   "of your last N resolved fears, X% actually realised"
--   "you spent the most cognitive energy on FEAR_KIND but only Y% realised"
--   "FEAR_KIND is your most accurate fear category — when you fear that,
--    take it seriously"
--
-- Six resolutions (plus dismiss + archive + open):
--   realised             — feared event happened. The fear was prophetic.
--   partially_realised   — some of the feared event happened (count as 0.5
--                           in realisation_rate).
--   dissolved            — feared event did not happen and is no longer
--                           feared.
--   displaced            — feared event did not happen but the fear has
--                           been replaced by another (the underlying
--                           pattern is still present even if this specific
--                           fear is dead).
--   unresolved           — outcome pending (deliberate "still tracking"
--                           flag, distinct from default open).
--   dismissed            — false positive from the scan.
--   archived             — soft hide.
--   open                 — default, awaiting outcome.

create table if not exists public.fears (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid,

  fear_text text not null check (char_length(fear_text) between 4 and 280),
  -- The feared event/outcome stated as a CLAIM about the future. e.g.
  -- "this hire will fall through", "my partner will leave if I name this",
  -- "I'll never make rent next month", "the deal will collapse last
  -- minute", "I'll embarrass myself on the call".

  fear_kind text not null check (fear_kind in (
    'catastrophising',
    'abandonment',
    'rejection',
    'failure',
    'loss',
    'shame',
    'inadequacy',
    'loss_of_control',
    'mortality',
    'future_uncertainty'
  )),
  -- The flavour of the fear:
  --   catastrophising      — "everything is going to fall apart"
  --   abandonment          — "they will leave / cut me off"
  --   rejection            — "they will say no / pull away / not pick me"
  --   failure              — "I will not be able to do this"
  --   loss                 — "I will lose [thing/person/money/status]"
  --   shame                — "I will be exposed as X / they will see me as Y"
  --   inadequacy           — "I am not enough / will be found out"
  --   loss_of_control      — "I will not be able to handle / contain X"
  --   mortality            — fear of death / illness / serious harm
  --   future_uncertainty   — diffuse worry about an unknown future

  feared_subject text,
  -- Optional 4-160 chars naming what / who the fear is about. e.g.
  -- "the move to Berlin", "Sarah's response", "the seed round closing",
  -- "next week's pitch", "telling dad about the leave".

  domain text not null check (domain in (
    'relationships', 'work', 'money', 'health',
    'decision', 'opportunity', 'safety', 'self', 'unknown'
  )),

  charge smallint not null check (charge between 1 and 5),
  -- 1 = passing worry
  -- 5 = visceral fear that's bending behaviour

  recency text not null check (recency in ('recent', 'older')),
  spoken_date date not null,
  spoken_message_id text not null,
  conversation_id uuid,

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'open' check (status in (
    'open',
    'realised', 'partially_realised',
    'dissolved', 'displaced',
    'unresolved',
    'dismissed', 'archived'
  )),

  resolution_note text,

  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fears_user_text_msg_uniq
  on public.fears (user_id, spoken_message_id, fear_text);

create index if not exists fears_user_status_date_idx
  on public.fears (user_id, status, spoken_date desc);

create index if not exists fears_user_open_idx
  on public.fears (user_id, spoken_date desc)
  where status = 'open' and archived_at is null;

create index if not exists fears_user_kind_idx
  on public.fears (user_id, fear_kind, spoken_date desc);

create index if not exists fears_user_domain_idx
  on public.fears (user_id, domain, spoken_date desc);

create index if not exists fears_user_pinned_idx
  on public.fears (user_id, spoken_date desc)
  where pinned = true;

create index if not exists fears_scan_idx
  on public.fears (scan_id);

alter table public.fears enable row level security;

drop policy if exists fears_select_own on public.fears;
create policy fears_select_own on public.fears
  for select using (auth.uid() = user_id);

drop policy if exists fears_insert_own on public.fears;
create policy fears_insert_own on public.fears
  for insert with check (auth.uid() = user_id);

drop policy if exists fears_update_own on public.fears;
create policy fears_update_own on public.fears
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists fears_delete_own on public.fears;
create policy fears_delete_own on public.fears
  for delete using (auth.uid() = user_id);

create or replace function public.touch_fears_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fears_touch_updated_at on public.fears;
create trigger fears_touch_updated_at
  before update on public.fears
  for each row execute function public.touch_fears_updated_at();
