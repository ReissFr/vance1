-- 0042_budgets.sql — monthly category budgets + alert dedup.
-- Works off receipts.category + subscriptions.category. User sets a monthly
-- cap per category; a cron checks MTD totals and fires WhatsApp alerts at
-- 80% (warn) and 100% (breach), once per threshold per month.

create table if not exists public.budgets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  category        text not null,
  amount          numeric(10, 2) not null check (amount > 0),
  currency        text not null default 'GBP',
  period          text not null default 'month' check (period in ('month')),
  include_subs    boolean not null default true,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, category, period)
);

create index if not exists budgets_user_idx on public.budgets (user_id, active);

alter table public.budgets enable row level security;

create policy budgets_own_all
  on public.budgets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Ledger of alerts we've already fired per period so we don't spam.
create table if not exists public.budget_alerts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  budget_id       uuid not null references public.budgets(id) on delete cascade,
  period_start    date not null,
  threshold       text not null check (threshold in ('warn', 'breach')),
  spent           numeric(10, 2) not null,
  budget_amount   numeric(10, 2) not null,
  fired_at        timestamptz not null default now(),
  unique (budget_id, period_start, threshold)
);

create index if not exists budget_alerts_user_idx
  on public.budget_alerts (user_id, fired_at desc);

alter table public.budget_alerts enable row level security;

create policy budget_alerts_own_read
  on public.budget_alerts for select
  using (auth.uid() = user_id);
