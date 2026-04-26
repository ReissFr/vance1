-- §171 — The Imagined-Future Register
--
-- Completes the four-corner temporal coordinate system of self-imagination:
--   §165 used-to       — past selves you've LOST
--   §169 thresholds    — present selves you've CROSSED INTO
--   §170 almosts       — present selves you ALMOST crossed into and didn't
--   §171 imagined-futures — future selves you've been VISITING mentally
--
-- The novel diagnostic field is `pull_kind`:
--   seeking      — a genuine pull. This future is asking to be made real.
--   escaping     — a pressure-release valve. The imagining is doing the
--                  work itself; the future is not the actual goal.
--   grieving     — mourning a path that has already closed. The
--                  imagining is grief work, not planning work.
--   entertaining — curiosity without weight. Idle wondering. Not a pull.
--
-- Same surface phrase ("I keep thinking about moving to Lisbon") can be
-- ANY of the four. Naming which IS the move. Most futures-tracking tools
-- collapse this into "make it a goal" (force pursue) or "stop daydreaming"
-- (force release). The four-way split refuses the binary.
--
-- The novel resolution mode is `pursue` — converts an imagined future
-- into a present step. status_note IS the first concrete action. Optional
-- pursue_intention_id links to a downstream task/intention.

create table if not exists public.imagined_futures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null default gen_random_uuid(),

  -- The named imagining
  act_text text not null check (length(act_text) between 4 and 220),
  future_state text not null check (length(future_state) between 4 and 360),

  -- The diagnostic field — the kind of pull
  pull_kind text not null check (pull_kind in ('seeking','escaping','grieving','entertaining')),

  domain text not null check (domain in (
    'work','health','relationships','family','finance','creative','self','spiritual','other'
  )),
  weight smallint not null check (weight between 1 and 5),
  recency text not null check (recency in ('recent','older')),

  confidence smallint not null check (confidence between 1 and 5),
  spoken_date date not null,
  spoken_message_id text,
  conversation_id uuid,

  -- Resolution
  status text not null check (status in ('active','pursuing','released','sitting_with','grieved','dismissed')) default 'active',
  status_note text,
  pursue_intention_id uuid,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  -- Audit
  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists imagined_futures_user_msg_unique
  on public.imagined_futures (user_id, spoken_message_id)
  where spoken_message_id is not null;

create index if not exists imagined_futures_user_date
  on public.imagined_futures (user_id, spoken_date desc, weight desc);

create index if not exists imagined_futures_user_active
  on public.imagined_futures (user_id, weight desc, spoken_date desc)
  where status = 'active' and archived_at is null;

create index if not exists imagined_futures_user_kind
  on public.imagined_futures (user_id, pull_kind, weight desc);

create index if not exists imagined_futures_user_domain
  on public.imagined_futures (user_id, domain, spoken_date desc);

create index if not exists imagined_futures_user_pinned
  on public.imagined_futures (user_id, spoken_date desc)
  where pinned = true and archived_at is null;

create index if not exists imagined_futures_scan
  on public.imagined_futures (scan_id);

alter table public.imagined_futures enable row level security;

create policy "imagined_futures_select_own"
  on public.imagined_futures for select
  using (auth.uid() = user_id);

create policy "imagined_futures_insert_own"
  on public.imagined_futures for insert
  with check (auth.uid() = user_id);

create policy "imagined_futures_update_own"
  on public.imagined_futures for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "imagined_futures_delete_own"
  on public.imagined_futures for delete
  using (auth.uid() = user_id);
