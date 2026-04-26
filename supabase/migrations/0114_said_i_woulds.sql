-- §175 — THE SAID-I-WOULD LEDGER (auto-extracted casual promises).
-- Distinct from:
--   §172 vows               — eternal promises-to-self ("I will always X")
--   §168 shoulds            — felt obligations ("I should X")
--   commitments table       — formal commitments to others
-- This captures the TINY casual "I'll" / "I'm going to" / "let me" / "I'll
-- text her tomorrow" promises the user makes in passing throughout the
-- day. Most get lost. The novel hook is twofold:
--   1. HORIZON INFERENCE FROM LANGUAGE — "tomorrow", "this weekend",
--      "next month", "soon", "eventually" each map to a target_date the
--      server computes from the spoken_date.
--   2. FOLLOW-THROUGH CALIBRATION — over many resolved promises the user
--      sees follow_through_rate per domain / per horizon_kind / overall.
--      Surfaces the gap between what the user SAYS they'll do and what
--      they ACTUALLY do, broken down so the user can see where the gap
--      is widest.
--
-- Resolutions: kept / partial / broken / forgotten / dismissed. The
-- distinction between BROKEN (explicitly chose not to) and FORGOTTEN
-- (didn't remember until prompted) is the novel diagnostic — chronic
-- forgetting is different from chronic non-commitment.

create table if not exists public.said_i_woulds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid,

  promise_text text not null check (length(promise_text) between 4 and 280),
  horizon_text text not null check (length(horizon_text) between 1 and 80),
  horizon_kind text not null check (horizon_kind in (
    'today',
    'tomorrow',
    'this_week',
    'this_weekend',
    'next_week',
    'this_month',
    'next_month',
    'soon',
    'eventually',
    'unspecified'
  )),
  domain text not null check (domain in (
    'work', 'health', 'relationships', 'family', 'finance',
    'creative', 'self', 'spiritual', 'other'
  )),

  -- timing
  spoken_date date not null,
  spoken_message_id text not null,
  conversation_id uuid,
  target_date date not null,

  confidence smallint not null check (confidence between 1 and 5),

  -- resolution
  status text not null default 'pending' check (status in (
    'pending', 'kept', 'partial', 'broken', 'forgotten', 'dismissed'
  )),
  resolution_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  -- audit
  latency_ms integer,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- partial unique on (user_id, spoken_message_id, promise_text) so rescans
-- of the same message don't duplicate. promise_text is part of the key
-- because one message can contain multiple promises.
create unique index if not exists said_i_woulds_dedup_idx
  on public.said_i_woulds (user_id, spoken_message_id, promise_text);

create index if not exists said_i_woulds_user_target_idx
  on public.said_i_woulds (user_id, target_date desc);
create index if not exists said_i_woulds_user_status_idx
  on public.said_i_woulds (user_id, status, target_date desc)
  where archived_at is null;
create index if not exists said_i_woulds_user_domain_idx
  on public.said_i_woulds (user_id, domain, status);
create index if not exists said_i_woulds_user_pending_due_idx
  on public.said_i_woulds (user_id, target_date)
  where status = 'pending' and archived_at is null;
create index if not exists said_i_woulds_user_pinned_idx
  on public.said_i_woulds (user_id, target_date desc)
  where pinned = true;
create index if not exists said_i_woulds_scan_id_idx
  on public.said_i_woulds (scan_id);

alter table public.said_i_woulds enable row level security;

create policy said_i_woulds_select_own on public.said_i_woulds
  for select using (auth.uid() = user_id);
create policy said_i_woulds_insert_own on public.said_i_woulds
  for insert with check (auth.uid() = user_id);
create policy said_i_woulds_update_own on public.said_i_woulds
  for update using (auth.uid() = user_id);
create policy said_i_woulds_delete_own on public.said_i_woulds
  for delete using (auth.uid() = user_id);

create or replace function public.touch_said_i_woulds_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists said_i_woulds_touch_updated_at on public.said_i_woulds;
create trigger said_i_woulds_touch_updated_at
  before update on public.said_i_woulds
  for each row execute function public.touch_said_i_woulds_updated_at();
