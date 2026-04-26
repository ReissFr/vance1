-- §167 The Voice Cabinet
-- Synthesis layer over §165 used_to and §166 shoulds + direct inheritance phrase mining.
-- Names the discrete VOICES that live in the user's head (Mum, Inner Critic, Founder Voice,
-- Past Self, etc.), scores their airtime + influence, and gives the user three resolution
-- modes per voice: acknowledge (you are heard), integrate (keep this voice's wisdom and
-- name what), retire (you no longer have authority over me, name why).
--
-- Different from §166 (which mines individual shoulds and their sources) — this aggregates
-- across all source attributions to produce one row per voice, with an airtime score and
-- a chargeable retire/integrate path so the user can consciously author their inner cast.
--
-- Table named voice_cabinet (not voices) because /api/voices is already taken by the
-- ElevenLabs TTS picker. The user-facing surface is "The Voice Cabinet" at /cabinet.

create table if not exists voice_cabinet (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  scan_id uuid not null,

  voice_name text not null,
  voice_type text not null check (voice_type in (
    'parent',
    'partner',
    'inner_critic',
    'social_norm',
    'professional_norm',
    'financial_judge',
    'past_self',
    'future_self',
    'mentor',
    'abstract_other'
  )),

  voice_relation text,

  typical_phrases jsonb not null default '[]'::jsonb,
  typical_obligations text not null,
  typical_kinds jsonb not null default '[]'::jsonb,
  typical_domains jsonb not null default '[]'::jsonb,

  airtime_score int not null default 0,
  influence_severity smallint not null check (influence_severity between 1 and 5),
  charge_average numeric(3,2),

  shoulds_attributed int not null default 0,
  used_to_linked int not null default 0,
  inheritance_mentions int not null default 0,

  first_detected_at date not null,
  last_detected_at date not null,
  detection_span_days int not null default 1,

  confidence smallint not null check (confidence between 1 and 5),

  status text not null default 'active' check (status in (
    'active',
    'acknowledged',
    'integrating',
    'retired',
    'dismissed'
  )),
  status_note text,
  resolved_at timestamptz,

  pinned boolean not null default false,
  archived_at timestamptz,

  latency_ms int,
  model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists voice_cabinet_user_name_unique_idx
  on voice_cabinet (user_id, lower(voice_name));

create index if not exists voice_cabinet_user_airtime_idx
  on voice_cabinet (user_id, airtime_score desc, influence_severity desc);

create index if not exists voice_cabinet_user_active_severity_idx
  on voice_cabinet (user_id, influence_severity desc, airtime_score desc)
  where status = 'active' and archived_at is null;

create index if not exists voice_cabinet_user_type_idx
  on voice_cabinet (user_id, voice_type, airtime_score desc);

create index if not exists voice_cabinet_user_pinned_idx
  on voice_cabinet (user_id, airtime_score desc)
  where pinned = true;

create index if not exists voice_cabinet_scan_id_idx
  on voice_cabinet (scan_id);

alter table voice_cabinet enable row level security;

create policy "voice_cabinet_select_own"
  on voice_cabinet for select
  using (auth.uid() = user_id);

create policy "voice_cabinet_insert_own"
  on voice_cabinet for insert
  with check (auth.uid() = user_id);

create policy "voice_cabinet_update_own"
  on voice_cabinet for update
  using (auth.uid() = user_id);

create policy "voice_cabinet_delete_own"
  on voice_cabinet for delete
  using (auth.uid() = user_id);
