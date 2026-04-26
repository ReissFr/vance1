-- §168 Mind Theatre
-- Convenes the §167 voice_cabinet voices to speak IN CHARACTER on a current
-- question or decision the user is sitting with. Externalises the internal
-- noise into a panel of named voices whose replies are generated from each
-- voice's typical_obligations, voice_relation, and voice_type.
--
-- The novel move: after reading the panel, the user picks one of four
-- outcomes per session:
--   went_with_voice — name the voice you followed (gives that voice airtime)
--   self_authored   — override everyone, write your own answer
--   silenced_voice  — consciously refuse a specific voice; nudges that voice
--                     toward retire in the cabinet (this is the move you can't
--                     make in IFS or parts-work — naming the voice and
--                     refusing its vote on THIS specific question)
--   unresolved      — sitting with it
--
-- One Haiku call per session generates the full panel. Cached per session_id
-- so re-reading is free.

create table if not exists mind_theatre_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  question text not null,
  context_note text,

  panel jsonb not null default '[]'::jsonb,
  voices_consulted int not null default 0,
  dominant_stance text,

  outcome text not null default 'unresolved' check (outcome in (
    'unresolved',
    'went_with_voice',
    'self_authored',
    'silenced_voice'
  )),

  chosen_voice_id uuid references voice_cabinet(id) on delete set null,
  silenced_voice_id uuid references voice_cabinet(id) on delete set null,
  self_authored_answer text,
  decision_note text,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  archived_at timestamptz
);

create index if not exists mind_theatre_user_recent_idx
  on mind_theatre_sessions (user_id, created_at desc);

create index if not exists mind_theatre_user_unresolved_idx
  on mind_theatre_sessions (user_id, created_at desc)
  where outcome = 'unresolved' and archived_at is null;

create index if not exists mind_theatre_user_chosen_idx
  on mind_theatre_sessions (user_id, chosen_voice_id, resolved_at desc)
  where chosen_voice_id is not null;

create index if not exists mind_theatre_user_silenced_idx
  on mind_theatre_sessions (user_id, silenced_voice_id, resolved_at desc)
  where silenced_voice_id is not null;

alter table mind_theatre_sessions enable row level security;

create policy "mind_theatre_select_own"
  on mind_theatre_sessions for select
  using (auth.uid() = user_id);

create policy "mind_theatre_insert_own"
  on mind_theatre_sessions for insert
  with check (auth.uid() = user_id);

create policy "mind_theatre_update_own"
  on mind_theatre_sessions for update
  using (auth.uid() = user_id);

create policy "mind_theatre_delete_own"
  on mind_theatre_sessions for delete
  using (auth.uid() = user_id);
