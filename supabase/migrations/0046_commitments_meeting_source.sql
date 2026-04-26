-- Generalise commitments source tracking so the extractor can ingest from
-- meeting transcripts (Meeting Ghost) as well as email. Adds:
--   - source_kind: 'email' (default, preserves existing rows) or 'meeting'
--   - source_meeting_id: fk to meeting_sessions when source_kind='meeting'
--   - source_meeting_title: human-readable meeting title (redundant but
--     avoids a join when rendering the commitments list)

alter table public.commitments
  add column if not exists source_kind text not null default 'email'
    check (source_kind in ('email', 'meeting'));

alter table public.commitments
  add column if not exists source_meeting_id uuid
    references public.meeting_sessions(id) on delete set null;

alter table public.commitments
  add column if not exists source_meeting_title text;

create index if not exists commitments_user_source_meeting_idx
  on public.commitments(user_id, source_meeting_id)
  where source_meeting_id is not null;
