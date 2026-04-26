-- Pinned memories always ride along in the brain's context window, independent
-- of semantic match. Useful for identity/context facts that should never be
-- forgotten ("I'm allergic to dairy", "my daughter's name is Mira") where a
-- retrieval miss would hurt the conversation.
--
-- Kept as a plain boolean — no priority tiers. If we need those later we can
-- upgrade to integer priority; boolean covers the 95% use case.

alter table public.memories
  add column if not exists pinned boolean not null default false;

create index if not exists memories_user_pinned_idx
  on public.memories(user_id)
  where pinned;
