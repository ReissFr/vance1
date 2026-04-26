-- §177 — THE PERMISSION-SLIPS LEDGER.
--
-- Captures the user's NEGATIVE self-constraints — every "I can't", "I'm
-- not allowed to", "I shouldn't be", "it's not for me", "I'm not the
-- kind of person who" they voice about themselves. The constraints
-- they place on themselves negatively.
--
-- Distinct from:
--   §168 shoulds — felt obligations TO DO X. Permission-slips refuse
--                  things rather than demand them.
--   §172 vows    — positive self-authored rules ("I always", "I never").
--                  Permission-slips are not principles but blocks.
--
-- The novel hook is THE SIGNER. For every refusal, there is an implied
-- AUTHORITY that needs to grant permission. Most permission-slips have
-- an implicit external signer the user hasn't noticed they're answering
-- to: parents, partner, peers, the profession, society, employer, or
-- circumstance. Surfacing that signer is half the move.
--
-- Four resolutions, refusing the binary of "obey the constraint" /
-- "ignore the constraint":
--
--   signed_by_self    — the user signs their own permission slip. The
--                       novel resolution. Refuses the assumption that
--                       someone else needs to grant. resolution_note IS
--                       the permission the user is granting themselves.
--
--   re_signed_by_other — the constraint is legitimate; accepted with
--                       eyes open. The signer is named and the reason
--                       is acknowledged. resolution_note IS the
--                       legitimate reason.
--
--   refused           — the slip isn't real / the authority is
--                       illegitimate. resolution_note IS why the slip
--                       is rejected.
--
--   dismissed         — false-positive scan.

create table if not exists public.permission_slips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid,

  forbidden_action text not null check (char_length(forbidden_action) between 4 and 280),
  -- The verbatim/distilled phrasing of what the user says they can't do.
  -- e.g. "take a sabbatical this year", "write fiction", "be the loud
  -- person in the room", "ask for a raise", "rest without earning it".

  signer text not null check (signer in (
    'self', 'parent', 'partner', 'peers', 'society',
    'employer', 'profession', 'circumstance', 'unknown'
  )),
  -- WHO holds the permission slip. THE NOVEL DIAGNOSTIC FIELD.
  --   self        — the user is the only one in the way (rarely picked
  --                 by the model on first scan; usually surfaces after
  --                 the user reckons)
  --   parent      — internalised parental voice ("my dad never let us")
  --   partner     — current partner's expectations
  --   peers       — peer group's silent norms ("none of my friends do")
  --   society     — diffuse "people don't do that"
  --   employer    — the workplace / boss
  --   profession  — industry norms ("you're not a real X if you do Y")
  --   circumstance — material facts (money, health, time)
  --   unknown     — model can't tell

  authority_text text,
  -- Optional 4-160 chars phrasing of WHO/WHAT specifically is the
  -- authority, when the model can name it. e.g. "my dad", "the industry
  -- I'm in", "my mortgage", "the rules of investment journalism".

  domain text not null check (domain in (
    'work', 'health', 'relationships', 'family', 'finance',
    'creative', 'self', 'spiritual', 'other'
  )),

  charge smallint not null check (charge between 1 and 5),
  -- 1 = passing remark
  -- 5 = load-bearing self-restriction shaping the user's life

  recency text not null check (recency in ('recent', 'older')),
  spoken_date date not null,
  spoken_message_id text not null,
  conversation_id uuid,
  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'open' check (status in (
    'open', 'signed_by_self', 're_signed', 'refused', 'dismissed', 'archived'
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

-- Same forbidden_action+signer shouldn't duplicate. UPSERT-by key.
create unique index if not exists permission_slips_user_action_uniq
  on public.permission_slips (user_id, forbidden_action, signer)
  where archived_at is null;

create index if not exists permission_slips_user_recent_idx
  on public.permission_slips (user_id, spoken_date desc, charge desc);

create index if not exists permission_slips_user_open_idx
  on public.permission_slips (user_id, charge desc, spoken_date desc)
  where status = 'open' and archived_at is null;

create index if not exists permission_slips_user_signer_idx
  on public.permission_slips (user_id, signer, spoken_date desc);

create index if not exists permission_slips_user_pinned_idx
  on public.permission_slips (user_id, spoken_date desc)
  where pinned = true;

create index if not exists permission_slips_user_domain_idx
  on public.permission_slips (user_id, domain, spoken_date desc);

create index if not exists permission_slips_scan_idx
  on public.permission_slips (scan_id);

alter table public.permission_slips enable row level security;

drop policy if exists permission_slips_select_own on public.permission_slips;
create policy permission_slips_select_own on public.permission_slips
  for select using (auth.uid() = user_id);

drop policy if exists permission_slips_insert_own on public.permission_slips;
create policy permission_slips_insert_own on public.permission_slips
  for insert with check (auth.uid() = user_id);

drop policy if exists permission_slips_update_own on public.permission_slips;
create policy permission_slips_update_own on public.permission_slips
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists permission_slips_delete_own on public.permission_slips;
create policy permission_slips_delete_own on public.permission_slips
  for delete using (auth.uid() = user_id);

create or replace function public.touch_permission_slips_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists permission_slips_touch_updated_at on public.permission_slips;
create trigger permission_slips_touch_updated_at
  before update on public.permission_slips
  for each row execute function public.touch_permission_slips_updated_at();
