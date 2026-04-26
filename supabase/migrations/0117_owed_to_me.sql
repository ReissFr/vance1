-- §178 — THE OWED-TO-ME LEDGER.
--
-- The clean inverse mirror of §175 said-i-would.
--
--   §175 said_i_woulds — promises THE USER made, owed BY them.
--   §178 owed_to_me     — promises OTHERS made to the user, owed TO them.
--
-- Captures the casual "she said she'd send it tomorrow" / "he promised
-- he'd help" / "they said they'd get back to me" / "the contractor said
-- he'd be done by Friday" — promises made TO the user that they are
-- implicitly waiting on. The cognitive overhead of carrying an unfulfilled
-- promise from someone else is real. Most users carry several silently.
--
-- THE NOVEL DIAGNOSTIC FIELD is RELATIONSHIP_WITH. Who is making the most
-- unkept promises to you? Cross-tab on relationship_with surfaces the
-- pattern — chronic non-followthrough from specific people, or one
-- specific person who's been quietly taking up your bandwidth.
--
-- THE NOVEL RESOLUTION is RAISED. Refuses the binary of "wait quietly
-- forever / get angry and burn it down". RAISED means: you brought it up,
-- named the unmet promise, made the conversation. The cognitive weight
-- transfers from the user's head into a real exchange.
--
-- Eight resolutions:
--   kept          — they did the thing.
--   broken        — they explicitly didn't (named it, declined).
--   forgotten     — they probably forgot; you've let it go without raising.
--   raised        — you brought it up. THE NOVEL RESOLUTION. Plus an
--                   optional raised_outcome enum tracking what happened.
--   released      — you've let it go without expecting it to happen.
--   dismissed     — false positive from the scan.
--   archived      — soft hide.
--   open          — default, still waiting.

create table if not exists public.owed_to_me (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid,

  promise_text text not null check (char_length(promise_text) between 4 and 280),
  -- The casual "they said they'd X" promise distilled in second-person
  -- reference to the promiser. e.g. "send the design files by tomorrow",
  -- "get back to me about the role next week", "fix the boiler this
  -- weekend", "let me know about the dinner".

  horizon_text text not null check (char_length(horizon_text) between 1 and 80),
  -- The literal horizon phrase used in the original message. e.g.
  -- "tomorrow", "next week", "by Friday", "this weekend", "soon",
  -- "later", "in a bit".

  horizon_kind text not null check (horizon_kind in (
    'today', 'tomorrow', 'this_week', 'this_weekend',
    'next_week', 'this_month', 'next_month',
    'soon', 'eventually', 'unspecified'
  )),
  -- Server computes target_date AUTHORITATIVELY from horizon_kind +
  -- spoken_date. Never trust the model with date arithmetic.

  relationship_with text not null check (relationship_with in (
    'partner', 'parent', 'sibling', 'friend',
    'colleague', 'boss', 'client', 'stranger', 'unknown'
  )),
  -- THE NOVEL DIAGNOSTIC FIELD. Who is making this promise? The cross-tab
  -- on this field surfaces the implicit pattern: who's been quietly
  -- taking up your bandwidth with unkept promises?
  --   partner    — current romantic partner
  --   parent     — mother, father, parental figure
  --   sibling    — brother, sister
  --   friend     — close friend or peer
  --   colleague  — coworker (peer relationship)
  --   boss       — manager, employer
  --   client     — customer, paying party, business client
  --   stranger   — someone the user doesn't know well (contractor, GP, etc)
  --   unknown    — model can't tell

  person_text text,
  -- Optional 4-160 chars phrasing of the specific person/role, when
  -- nameable. e.g. "my dad", "Sarah from the design team",
  -- "the contractor", "the consultant we hired", "Tom my GP".

  domain text not null check (domain in (
    'work', 'health', 'relationships', 'family', 'finance',
    'creative', 'self', 'spiritual', 'other'
  )),

  charge smallint not null check (charge between 1 and 5),
  -- 1 = passing low-stakes promise
  -- 5 = load-bearing — significant chunk of the user's life is gated on
  --     this person doing what they said they'd do

  recency text not null check (recency in ('recent', 'older')),
  spoken_date date not null,
  spoken_message_id text not null,
  conversation_id uuid,
  target_date date not null,
  -- Server-computed from horizon_kind + spoken_date.

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'open' check (status in (
    'open', 'kept', 'broken', 'forgotten', 'raised', 'released',
    'dismissed', 'archived'
  )),
  resolution_note text,

  raised_outcome text check (raised_outcome is null or raised_outcome in (
    'they_followed_through', 'they_apologized', 'they_explained',
    'they_dismissed_it', 'no_response'
  )),
  -- Optional secondary field populated when status='raised'. Tracks what
  -- happened when the user raised it. The novel diagnostic-of-the-novel
  -- diagnostic: of the times you raised it, how often did they actually
  -- follow through afterwards?

  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same promise_text+spoken_message_id shouldn't duplicate.
create unique index if not exists owed_to_me_user_promise_msg_uniq
  on public.owed_to_me (user_id, spoken_message_id, promise_text);

create index if not exists owed_to_me_user_target_idx
  on public.owed_to_me (user_id, target_date asc)
  where status = 'open' and archived_at is null;

create index if not exists owed_to_me_user_status_date_idx
  on public.owed_to_me (user_id, status, spoken_date desc);

create index if not exists owed_to_me_user_relationship_idx
  on public.owed_to_me (user_id, relationship_with, spoken_date desc);

create index if not exists owed_to_me_user_pinned_idx
  on public.owed_to_me (user_id, spoken_date desc)
  where pinned = true;

create index if not exists owed_to_me_user_domain_idx
  on public.owed_to_me (user_id, domain, spoken_date desc);

create index if not exists owed_to_me_scan_idx
  on public.owed_to_me (scan_id);

alter table public.owed_to_me enable row level security;

drop policy if exists owed_to_me_select_own on public.owed_to_me;
create policy owed_to_me_select_own on public.owed_to_me
  for select using (auth.uid() = user_id);

drop policy if exists owed_to_me_insert_own on public.owed_to_me;
create policy owed_to_me_insert_own on public.owed_to_me
  for insert with check (auth.uid() = user_id);

drop policy if exists owed_to_me_update_own on public.owed_to_me;
create policy owed_to_me_update_own on public.owed_to_me
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists owed_to_me_delete_own on public.owed_to_me;
create policy owed_to_me_delete_own on public.owed_to_me
  for delete using (auth.uid() = user_id);

create or replace function public.touch_owed_to_me_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists owed_to_me_touch_updated_at on public.owed_to_me;
create trigger owed_to_me_touch_updated_at
  before update on public.owed_to_me
  for each row execute function public.touch_owed_to_me_updated_at();
