-- policies: reusable rules the brain enforces autonomously when acting on
-- the user's behalf. "I don't take meetings before 11am", "I don't do free
-- advice calls", "spend over £100 needs my approval", "no replies on
-- weekends". Distinct from decisions (one-time committed past choice) and
-- goals (target outcome) — policies are evergreen rules the brain checks
-- against situations before scheduling, drafting, or acting.
--
-- Categories scope where a policy applies so check_policies can prefilter:
--   scheduling     — meeting acceptance, time-blocking, working hours
--   communication  — reply style, response speed, channels
--   finance        — spend caps, approval thresholds, recurring charges
--   health         — sleep, food, drink, exercise rules
--   relationships  — who to prioritise, who to decline
--   work           — what work to take, what to refuse
--   general        — catch-all
--
-- Priority is 1-5 (5 = inviolable, 1 = soft preference). The brain weighs
-- this when policies conflict with user requests in the moment.

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  rule text not null,
  category text not null default 'general'
    check (category in (
      'scheduling','communication','finance','health',
      'relationships','work','general'
    )),
  priority integer not null default 3 check (priority between 1 and 5),
  active boolean not null default true,

  examples text,
  tags text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, name)
);

create index if not exists policies_user_active_idx
  on public.policies (user_id, active, category, priority desc);

create index if not exists policies_user_name_idx
  on public.policies (user_id, name);

alter table public.policies enable row level security;

create policy "policies: select own"
  on public.policies for select
  using (auth.uid() = user_id);

create policy "policies: insert own"
  on public.policies for insert
  with check (auth.uid() = user_id);

create policy "policies: update own"
  on public.policies for update
  using (auth.uid() = user_id);

create policy "policies: delete own"
  on public.policies for delete
  using (auth.uid() = user_id);
