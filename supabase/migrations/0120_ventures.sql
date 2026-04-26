-- §181 — JARVIS MODES + VENTURES (the CEO mode foundation)
--
-- Two-mode brain:
--   assistant — the default JARVIS we've built so far. PA, butler, executor.
--   ceo       — autonomous operator that runs the user's businesses
--               ("ventures") end-to-end on a daily heartbeat. Makes calls
--               within a per-venture decision-rights matrix; queues bigger
--               calls for the user; learns from every override.
--
-- The user toggles between modes from the header. The brain reads the
-- current mode at the start of each turn and swaps in a mode-specific
-- system-prompt block (see prompt.ts → ceoModeBlock).
--
-- A VENTURE is one business JARVIS is running. Each row owns:
--   - a thesis (what it is, who it serves, why now)
--   - a budget cap and a kill threshold
--   - an operator_memory blob (living strategy doc — JARVIS reads this every
--     heartbeat so it doesn't lose continuity)
--   - a decision_matrix (what JARVIS decides silently vs. notifies vs.
--     queues for approval) — the SaaS-ready version of "spend authority
--     tiers" but for ALL operational decisions, not just spend
--   - a status (researching / validated / building / launched / scaling /
--     paused / killed)
--
-- A VENTURE_DECISION is one ranked-and-classified action the operator loop
-- proposed during a heartbeat. tier='auto' executes silently and stamps
-- executed_at. tier='notify' fires a WhatsApp ping but doesn't block.
-- tier='approve' queues for the user; nothing happens until approved.
-- The user can override any silent decision retroactively — the override
-- becomes feedback the operator loop reads on the next heartbeat.
--
-- A VENTURE_SIGNAL is anything the operator loop should weigh: a customer
-- email, a churn event, a competitor move, a metric anomaly, a calendar
-- conflict. The loop pulls all unprocessed signals each heartbeat and
-- factors them into the decision pass.
--
-- A VENTURE_METRIC is a numeric data point captured over time (revenue,
-- spend, MAU, conversion, NPS). The loop reads the metric series each
-- heartbeat to spot trends and feed the auto-kill criteria.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. profiles.jarvis_mode — the toggle
-- ─────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists jarvis_mode text not null default 'assistant'
    check (jarvis_mode in ('assistant', 'ceo'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ventures — one row per business JARVIS runs
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.ventures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null check (char_length(name) between 2 and 80),
  -- Internal name for the venture. e.g. "Peptide Co", "AI invoice tool".

  thesis text not null check (char_length(thesis) between 20 and 2000),
  -- The full thesis: what it is, who it serves, why now, what bet you're
  -- making. The operator loop reads this every heartbeat.

  status text not null default 'researching' check (status in (
    'researching', 'validated', 'building', 'launched', 'scaling',
    'paused', 'killed'
  )),
  -- Pipeline:
  --   researching — JARVIS is mining for evidence the thesis holds
  --   validated   — enough evidence; ready to build
  --   building    — actively shipping product, no live revenue yet
  --   launched    — public, has at least one paying customer
  --   scaling     — repeatable acquisition, focus shifts to growth
  --   paused      — heartbeat suspended (user decision)
  --   killed      — terminal; auto-kill criteria hit OR user killed

  budget_pence bigint not null default 0 check (budget_pence >= 0),
  -- Total capital cap for this venture (pence).

  spent_pence bigint not null default 0 check (spent_pence >= 0),
  -- Running total of authorised spend (pence).

  kill_criteria text,
  -- Plain-English rule the loop evaluates each heartbeat. e.g.
  -- "if no paying customer by week 6, kill unless overridden".

  decision_matrix jsonb not null default '{
    "auto":    {"max_spend_pence": 5000, "kinds": ["copy", "feature_flag", "support_reply", "outreach"]},
    "notify":  {"max_spend_pence": 50000, "kinds": ["pricing_change", "ad_campaign", "partnership_outreach"]},
    "approve": {"kinds": ["pivot", "kill", "human_hire", "contract_sign", "product_add", "product_remove"]}
  }'::jsonb,
  -- Per-venture decision rights. The operator loop classifies each proposed
  -- decision into one of three tiers and routes accordingly:
  --   auto    — execute silently, log
  --   notify  — execute and ping WhatsApp
  --   approve — queue, do nothing until user approves
  -- decision.kind values come from this matrix.

  operator_memory text not null default '',
  -- The living strategy doc. The operator loop appends to this each
  -- heartbeat and rewrites the top-of-doc summary when context shifts.
  -- Format is plain markdown — the user can edit it directly from the
  -- venture detail page.

  thesis_revision int not null default 1,
  -- Bumped when the user materially edits the thesis. Lets the operator
  -- loop know the strategic foundation moved; heartbeat re-reads
  -- everything fresh.

  cadence text not null default 'daily' check (cadence in ('daily', 'twice_daily', 'hourly', 'weekly', 'manual')),
  -- How often the operator loop fires for this venture. Default daily
  -- (cron at 09:00 London). 'manual' means the user fires it explicitly.

  next_heartbeat_at timestamptz,
  -- Next scheduled operator-loop fire. Cron uses this to decide which
  -- ventures to process this minute.

  last_heartbeat_at timestamptz,
  -- Last operator-loop completion timestamp.

  launched_at timestamptz,
  killed_at timestamptz,
  killed_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ventures_user_status_idx
  on public.ventures (user_id, status, updated_at desc);

create index if not exists ventures_due_heartbeat_idx
  on public.ventures (next_heartbeat_at)
  where status not in ('paused', 'killed') and next_heartbeat_at is not null;

alter table public.ventures enable row level security;

drop policy if exists ventures_select_own on public.ventures;
create policy ventures_select_own on public.ventures
  for select using (auth.uid() = user_id);

drop policy if exists ventures_insert_own on public.ventures;
create policy ventures_insert_own on public.ventures
  for insert with check (auth.uid() = user_id);

drop policy if exists ventures_update_own on public.ventures;
create policy ventures_update_own on public.ventures
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ventures_delete_own on public.ventures;
create policy ventures_delete_own on public.ventures
  for delete using (auth.uid() = user_id);

create or replace function public.touch_ventures_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ventures_touch_updated_at on public.ventures;
create trigger ventures_touch_updated_at
  before update on public.ventures
  for each row execute function public.touch_ventures_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. venture_decisions — one row per proposed operational decision
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.venture_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,
  heartbeat_id uuid,
  -- Optional grouping by which heartbeat run produced this decision.

  kind text not null check (char_length(kind) between 2 and 80),
  -- Free-form but constrained-by-convention. e.g. 'copy_change',
  -- 'pricing_change', 'feature_flag', 'support_reply', 'outreach',
  -- 'ad_campaign', 'partnership_outreach', 'pivot', 'kill', 'human_hire',
  -- 'contract_sign', 'product_add', 'product_remove'.

  title text not null check (char_length(title) between 2 and 280),
  -- Short headline. e.g. "raise pro plan price from £29 to £35".

  body text not null check (char_length(body) between 4 and 4000),
  -- The decision in plain English: what, why, what changes, what's the
  -- expected effect.

  reasoning text,
  -- Optional Haiku-generated reasoning trace. The operator loop writes
  -- this as it proposes the decision so the user can later understand
  -- "why did JARVIS think this".

  signals_consulted jsonb not null default '[]'::jsonb,
  -- Array of {signal_id, summary} pairs the loop consulted when proposing.
  -- Lets the user trace cause→effect.

  estimated_spend_pence bigint not null default 0 check (estimated_spend_pence >= 0),

  confidence smallint not null check (confidence between 1 and 5),
  -- The loop's self-rated confidence (1=hunch, 5=strong evidence).

  tier text not null check (tier in ('auto', 'notify', 'approve')),
  -- Classified by the operator loop using the venture's decision_matrix.

  status text not null default 'proposed' check (status in (
    'proposed',
    'auto_executed', 'notified', 'queued',
    'approved', 'rejected', 'overridden',
    'executed', 'failed', 'cancelled'
  )),
  -- Lifecycle:
  --   proposed       — just produced by the loop
  --   auto_executed  — tier='auto' fired silently
  --   notified       — tier='notify' fired and WhatsApp ping sent
  --   queued         — tier='approve' awaiting user
  --   approved       — user approved a queued decision
  --   rejected       — user rejected a queued decision
  --   overridden     — user retroactively reversed an auto/notify decision
  --   executed       — actually carried out (after approve OR via auto/notify)
  --   failed         — execution attempted but failed
  --   cancelled      — user cancelled before execution

  outcome_note text,
  -- What actually happened after execution. Filled later (manually or
  -- by the loop reading downstream signals).

  outcome_postmortem_due_at timestamptz,
  -- When the loop should auto-evaluate this decision's outcome. Set
  -- typically 14-30 days out.

  executed_at timestamptz,
  user_responded_at timestamptz,
  user_response_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists venture_decisions_venture_status_idx
  on public.venture_decisions (venture_id, status, created_at desc);

create index if not exists venture_decisions_user_queued_idx
  on public.venture_decisions (user_id, created_at desc)
  where status = 'queued';

create index if not exists venture_decisions_postmortem_due_idx
  on public.venture_decisions (outcome_postmortem_due_at)
  where status in ('auto_executed', 'notified', 'executed')
    and outcome_postmortem_due_at is not null
    and outcome_note is null;

alter table public.venture_decisions enable row level security;

drop policy if exists venture_decisions_select_own on public.venture_decisions;
create policy venture_decisions_select_own on public.venture_decisions
  for select using (auth.uid() = user_id);

drop policy if exists venture_decisions_insert_own on public.venture_decisions;
create policy venture_decisions_insert_own on public.venture_decisions
  for insert with check (auth.uid() = user_id);

drop policy if exists venture_decisions_update_own on public.venture_decisions;
create policy venture_decisions_update_own on public.venture_decisions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists venture_decisions_delete_own on public.venture_decisions;
create policy venture_decisions_delete_own on public.venture_decisions
  for delete using (auth.uid() = user_id);

create or replace function public.touch_venture_decisions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists venture_decisions_touch_updated_at on public.venture_decisions;
create trigger venture_decisions_touch_updated_at
  before update on public.venture_decisions
  for each row execute function public.touch_venture_decisions_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. venture_signals — anything the operator loop should weigh
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.venture_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,

  kind text not null check (kind in (
    'customer_email', 'support_ticket', 'churn_event',
    'competitor_move', 'metric_anomaly', 'calendar_conflict',
    'review', 'feature_request', 'cancellation_reason',
    'press_mention', 'social_mention', 'other'
  )),

  body text not null check (char_length(body) between 2 and 4000),
  -- The signal content in plain English. e.g. "3 customers this week
  -- asked for SSO", "competitor X dropped their price by 30%".

  source text,
  -- Free-form pointer to where the signal came from. e.g.
  -- 'gmail:msg_abc', 'stripe:cus_xyz', 'manual'.

  weight smallint not null default 3 check (weight between 1 and 5),
  -- 1 = noise, 5 = pivot-worthy. The loop weights signals by this in
  -- the decision pass.

  processed_at timestamptz,
  -- When the operator loop folded this into a heartbeat. Unprocessed
  -- signals get pulled into the next heartbeat; processed ones get
  -- archived from the active stream.

  resulted_in_decision_id uuid references public.venture_decisions(id) on delete set null,

  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists venture_signals_unprocessed_idx
  on public.venture_signals (venture_id, captured_at desc)
  where processed_at is null;

create index if not exists venture_signals_venture_kind_idx
  on public.venture_signals (venture_id, kind, captured_at desc);

alter table public.venture_signals enable row level security;

drop policy if exists venture_signals_select_own on public.venture_signals;
create policy venture_signals_select_own on public.venture_signals
  for select using (auth.uid() = user_id);

drop policy if exists venture_signals_insert_own on public.venture_signals;
create policy venture_signals_insert_own on public.venture_signals
  for insert with check (auth.uid() = user_id);

drop policy if exists venture_signals_update_own on public.venture_signals;
create policy venture_signals_update_own on public.venture_signals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists venture_signals_delete_own on public.venture_signals;
create policy venture_signals_delete_own on public.venture_signals
  for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. venture_metrics — numeric data points over time
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.venture_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venture_id uuid not null references public.ventures(id) on delete cascade,

  metric_kind text not null check (metric_kind in (
    'revenue_pence', 'spend_pence', 'mrr_pence', 'arr_pence',
    'paying_customers', 'free_users', 'mau', 'wau', 'dau',
    'conversion_rate', 'churn_rate', 'nps',
    'page_views', 'signups', 'cac_pence', 'ltv_pence',
    'support_tickets_open', 'runway_days',
    'other'
  )),

  value numeric not null,
  -- Stored as numeric to allow rates (0.0234) and big bigint-style
  -- counts. UI formats per metric_kind.

  unit text,
  -- Optional unit hint when metric_kind='other'. e.g. 'kg', 'rooms_booked'.

  note text,

  captured_for_date date not null default current_date,
  -- The day this measurement represents. One metric_kind per
  -- (venture, date) is the convention but not enforced — multiple
  -- measurements per day are allowed (e.g. snapshot at 09:00 and 21:00).

  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists venture_metrics_series_idx
  on public.venture_metrics (venture_id, metric_kind, captured_for_date desc);

create index if not exists venture_metrics_recent_idx
  on public.venture_metrics (venture_id, captured_at desc);

alter table public.venture_metrics enable row level security;

drop policy if exists venture_metrics_select_own on public.venture_metrics;
create policy venture_metrics_select_own on public.venture_metrics
  for select using (auth.uid() = user_id);

drop policy if exists venture_metrics_insert_own on public.venture_metrics;
create policy venture_metrics_insert_own on public.venture_metrics
  for insert with check (auth.uid() = user_id);

drop policy if exists venture_metrics_update_own on public.venture_metrics;
create policy venture_metrics_update_own on public.venture_metrics
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists venture_metrics_delete_own on public.venture_metrics;
create policy venture_metrics_delete_own on public.venture_metrics
  for delete using (auth.uid() = user_id);
