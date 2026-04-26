-- predictions: calibration log. The user states a claim, a confidence
-- (0-100%), and a resolve-by date. When the date arrives — or earlier —
-- they mark it yes / no / withdrawn. Over time the calibration curve
-- shows whether "I'm 80% sure" actually means they're right 80% of the
-- time. Distinct from goals (target outcome the user is working toward)
-- and decisions (committed past choice) — predictions are forecasts of
-- external events the user does not directly control.

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  claim text not null,
  confidence integer not null check (confidence between 1 and 99),
  resolve_by date not null,

  status text not null default 'open'
    check (status in ('open','resolved_yes','resolved_no','withdrawn')),
  resolved_at timestamptz,
  resolved_note text,

  category text,
  tags text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists predictions_user_status_idx
  on public.predictions (user_id, status, resolve_by);

create index if not exists predictions_user_resolve_idx
  on public.predictions (user_id, resolve_by) where status = 'open';

alter table public.predictions enable row level security;

create policy "predictions: select own"
  on public.predictions for select
  using (auth.uid() = user_id);

create policy "predictions: insert own"
  on public.predictions for insert
  with check (auth.uid() = user_id);

create policy "predictions: update own"
  on public.predictions for update
  using (auth.uid() = user_id);

create policy "predictions: delete own"
  on public.predictions for delete
  using (auth.uid() = user_id);
