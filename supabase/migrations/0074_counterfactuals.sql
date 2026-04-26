-- counterfactuals: alternative paths the user didn't take.
--
-- For any logged decision, the brain can generate "what would have happened
-- if you'd chosen otherwise" — a Haiku-written narrative grounded in the
-- decision's actual context, alternatives field, and the user's broader
-- recent patterns. Each row pairs a decision with an alternative_choice
-- (the path not taken) and a body (the narrative the model wrote).
--
-- Useful for:
--   - retrospective: was the decision the user made actually better than
--     the alternative they keep wondering about?
--   - emotional closure: name and inspect the path not taken
--   - policy/decision learning: surface patterns in the user's regretted
--     vs. validated decisions
--
-- credibility is the *model's* self-rated confidence in the projection
-- (1-5). The user can override with their own note (user_note) and verdict
-- (verdict enum: regret_taken_path, validated_taken_path, neutral, unsure).

create table if not exists public.counterfactuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_id uuid not null references public.decisions(id) on delete cascade,

  alternative_choice text not null,
  body text not null,
  credibility smallint not null default 3 check (credibility between 1 and 5),

  user_note text,
  verdict text not null default 'unsure'
    check (verdict in ('regret_taken_path','validated_taken_path','neutral','unsure')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists counterfactuals_user_idx
  on public.counterfactuals (user_id, created_at desc);

create index if not exists counterfactuals_decision_idx
  on public.counterfactuals (decision_id, created_at desc);

create index if not exists counterfactuals_user_verdict_idx
  on public.counterfactuals (user_id, verdict, created_at desc);

alter table public.counterfactuals enable row level security;

create policy "counterfactuals: select own"
  on public.counterfactuals for select using (auth.uid() = user_id);
create policy "counterfactuals: insert own"
  on public.counterfactuals for insert with check (auth.uid() = user_id);
create policy "counterfactuals: update own"
  on public.counterfactuals for update using (auth.uid() = user_id);
create policy "counterfactuals: delete own"
  on public.counterfactuals for delete using (auth.uid() = user_id);
