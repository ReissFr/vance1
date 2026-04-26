-- brand_voice: singleton-per-user config consumed by the writer agent on
-- every draft. The user defines tone keywords, words to avoid, default
-- greeting/signature, and pastes sample writing that captures their voice.
-- The writer prepends this into its system prompt before drafting any
-- email/LinkedIn/tweet/message so output sounds like the user, not generic.

create table if not exists public.brand_voice (
  user_id uuid primary key references auth.users(id) on delete cascade,

  tone_keywords text[] not null default '{}',
  avoid_words text[] not null default '{}',
  greeting text,
  signature text,
  voice_notes text,

  sample_email text,
  sample_message text,
  sample_post text,

  updated_at timestamptz not null default now()
);

alter table public.brand_voice enable row level security;

create policy "brand_voice: select own"
  on public.brand_voice for select using (auth.uid() = user_id);
create policy "brand_voice: insert own"
  on public.brand_voice for insert with check (auth.uid() = user_id);
create policy "brand_voice: update own"
  on public.brand_voice for update using (auth.uid() = user_id);
create policy "brand_voice: delete own"
  on public.brand_voice for delete using (auth.uid() = user_id);
