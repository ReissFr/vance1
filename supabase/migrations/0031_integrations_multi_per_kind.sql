-- Allow multiple active integrations per kind (Stripe + PayPal + Square all
-- active as 'payment' simultaneously; Xero + QuickBooks both as 'accounting').
-- Designate one row per (user, kind) as the default — that's the one the
-- resolver returns when callers don't specify a provider.

alter table public.integrations
  add column if not exists is_default boolean not null default false;

-- Drop the old "one active per kind" partial unique index. Replaced with
-- "one default per kind" so callers without a preference still resolve
-- deterministically.
drop index if exists public.integrations_one_active_per_kind;

create unique index if not exists integrations_one_default_per_kind
  on public.integrations(user_id, kind)
  where is_default and active;

-- Backfill: for every (user, kind) pair where there's exactly one active row,
-- promote it to default so existing single-provider users keep working.
update public.integrations i
set is_default = true
where i.active = true
  and not exists (
    select 1 from public.integrations i2
    where i2.user_id = i.user_id
      and i2.kind = i.kind
      and i2.id <> i.id
      and i2.active = true
  );

-- For (user, kind) pairs with multiple actives (shouldn't exist yet, but
-- defensive), pick the most recently updated as default.
with ranked as (
  select id, row_number() over (
    partition by user_id, kind order by updated_at desc nulls last, created_at desc
  ) as rn
  from public.integrations
  where active = true
    and (user_id, kind) in (
      select user_id, kind from public.integrations
      where active = true
      group by user_id, kind
      having count(*) > 1
    )
)
update public.integrations i
set is_default = true
from ranked r
where i.id = r.id and r.rn = 1;
