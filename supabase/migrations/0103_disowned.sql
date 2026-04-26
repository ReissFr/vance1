-- §164 The Disowned Register
--
-- Each row is a moment the user described their own experience as if it
-- belonged to someone else. Five kinds of disownership:
--   distancing_pronoun    — "you know that feeling when..." / "we all do this" / "people get like this" while describing self
--   external_attribution  — "the depression hit", "anxiety took over", "stress is doing this to me" — agent grammatically external
--   abstract_body         — "the chest tightens" / "the stomach drops" instead of MY chest / MY stomach
--   generic_universal     — "everyone has this" / "it's just life" / "that's how things are" while describing personal pain
--   passive_self          — "the gym wasn't visited" / "the message didn't get sent" — agentless passive when user IS the actor
--
-- The structural artifact this captures: the SPECTATOR voice. Where
-- self-erasures (§163) are a censor cancelling the first voice, dis-
-- ownership is a NARRATOR — a voice that watches the user's life from
-- a third-person remove. Reclaiming = saying it back as I, in active
-- voice. "The depression hit" → "I'm depressed". "The chest tightens"
-- → "my chest is tight". "The gym wasn't visited" → "I didn't go to
-- the gym."
--
-- The reframe mechanic: status='reclaimed' + status_note = the user's
-- I-form active-voice rewrite of the same sentence. Reclamation is the
-- move that turns the ledger from diagnosis into tool.
--
-- recurrence tracks how often the user disowns in the same shape;
-- chronic patterns reveal which TOPICS the spectator voice always
-- narrates from outside. recurrence_with_target counts recurrences
-- that ALSO had a real first-person subject available — i.e. the
-- spectator isn't just stylistic, it's catching genuine ownership.
--
-- No therapy/journaling app captures grammatical disownership as
-- structural identity-disowning. Pronoun shifts and agentless passives
-- look like neutral writing choices; this layer recognises them as the
-- voice of the OBSERVER stepping in.

create table if not exists public.disowned (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id uuid not null,

  disowned_text text not null,                         -- verbatim disowned phrase ≤200 chars
  disowned_kind text not null check (disowned_kind in (
    'distancing_pronoun','external_attribution','abstract_body','generic_universal','passive_self'
  )),

  what_was_disowned text,                              -- the first-person reading: what the user actually meant about themselves (≤320 chars)
  what_was_disowned_kind text check (what_was_disowned_kind in (
    'emotion','bodily_state','mental_state','relationship_dynamic','behaviour','need','desire','judgment'
  )),

  self_voice text,                                     -- 2-5 word inferred internal voice — "the spectator", "the narrator", "the patient", "the observer", "the third-person voice"

  domain text not null check (domain in (
    'work','relationships','health','identity','finance','creative','learning','daily','other'
  )),
  spoken_date date not null,
  spoken_message_id uuid,
  spoken_conversation_id uuid,

  recurrence_count int not null default 1,             -- DISTINCT messages with the same disownership shape across the window
  recurrence_days int not null default 1,
  recurrence_with_target int not null default 0,       -- recurrences that also had a real first-person subject available
  recurrence_samples jsonb not null default '[]'::jsonb,  -- [{date, snippet}] up to 5 PRIOR-IN-WINDOW disownerships of same shape

  pattern_severity smallint not null check (pattern_severity between 1 and 5),
  -- 5 = recurrence ≥12 with target ≥5 — reflex disownership (spectator IS the narrator)
  -- 4 = recurrence ≥8 with target ≥3 — entrenched spectator
  -- 3 = recurrence ≥4 with kind in (external_attribution, abstract_body) — habitual self-removal
  -- 2 = recurrence ≥3 mixed
  -- 1 = isolated disownership

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'pending' check (status in (
    'pending','reclaimed','kept','noted','dismissed'
  )),
  -- reclaimed = user typed the I-form active-voice rewrite (status_note = reclaimed_text)
  -- kept      = user explicitly chose the disowned framing (status_note = reason)
  -- noted     = acknowledged but neither reclaimed nor kept
  -- dismissed = not actually a disownership (false positive)
  status_note text,
  resolved_at timestamptz,
  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists disowned_user_recent_idx
  on public.disowned (user_id, spoken_date desc);
create index if not exists disowned_user_pending_severity_idx
  on public.disowned (user_id, pattern_severity desc, spoken_date desc)
  where status = 'pending' and archived_at is null;
create index if not exists disowned_user_kind_idx
  on public.disowned (user_id, disowned_kind, spoken_date desc);
create index if not exists disowned_user_pinned_idx
  on public.disowned (user_id, spoken_date desc) where pinned = true;
create index if not exists disowned_scan_idx
  on public.disowned (scan_id);

alter table public.disowned enable row level security;

drop policy if exists "disowned-select-own" on public.disowned;
drop policy if exists "disowned-insert-own" on public.disowned;
drop policy if exists "disowned-update-own" on public.disowned;
drop policy if exists "disowned-delete-own" on public.disowned;

create policy "disowned-select-own" on public.disowned
  for select using (auth.uid() = user_id);
create policy "disowned-insert-own" on public.disowned
  for insert with check (auth.uid() = user_id);
create policy "disowned-update-own" on public.disowned
  for update using (auth.uid() = user_id);
create policy "disowned-delete-own" on public.disowned
  for delete using (auth.uid() = user_id);
