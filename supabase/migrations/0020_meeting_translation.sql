-- Live translation for Meeting Ghost.
--
-- When translate_to_english is on, the chunk endpoint asks Whisper to
-- transcribe with auto-detected language, and if the detected language is not
-- English, runs the text through Haiku for translation. We keep the original
-- text and language code alongside the displayed English text so nothing is
-- lost and the detail view can show both.

alter table public.meeting_sessions
  add column if not exists translate_to_english boolean not null default false,
  add column if not exists detected_language text;

alter table public.meeting_segments
  add column if not exists original_text text,
  add column if not exists language text;
