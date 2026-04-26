-- Allow 'manual' source_kind for commitments added by the user directly
-- (the POST /api/commitments path), alongside the existing 'email' and
-- 'meeting' auto-extracted kinds.
--
-- The check constraint added in 0046 was unnamed, so Postgres auto-named it
-- based on column ordering — typically commitments_source_kind_check, but
-- not guaranteed. We introspect the system catalog so this migration is
-- idempotent regardless of the original constraint name.

do $$
declare
  cname text;
begin
  select conname into cname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'commitments'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%source_kind%email%meeting%'
    limit 1;
  if cname is not null then
    execute format('alter table public.commitments drop constraint %I', cname);
  end if;
end $$;

alter table public.commitments
  add constraint commitments_source_kind_check
    check (source_kind in ('email', 'meeting', 'manual'));
