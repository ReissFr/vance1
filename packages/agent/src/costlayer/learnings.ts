import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningCategory, SharedLearning } from "./types";

interface LearningRow {
  id: string;
  scope: string | null;
  fact: string;
  category: LearningCategory;
  upvotes: number;
  similarity?: number;
}

function rowToLearning(row: LearningRow): SharedLearning {
  return {
    id: row.id,
    scope: row.scope,
    fact: row.fact,
    category: row.category,
    upvotes: row.upvotes,
    ...(row.similarity !== undefined ? { similarity: row.similarity } : {}),
  };
}

// Fetch cross-user facts relevant to the current turn. Returns up to topK
// learnings, ranked by semantic similarity to the intent and then upvotes.
// Always includes global (scope = null) learnings as a fallback.
export async function lookupLearnings(
  supabase: SupabaseClient,
  args: {
    intentEmbedding: number[];
    site: string | null;
    topK?: number;
  },
): Promise<SharedLearning[]> {
  const { data, error } = await supabase.rpc("match_learnings", {
    p_query_embedding: args.intentEmbedding,
    p_scope: args.site,
    p_match_count: args.topK ?? 5,
    p_min_similarity: 0.60,
  });
  if (error) return [];
  return ((data ?? []) as LearningRow[]).map(rowToLearning);
}

export interface SaveLearningOptions {
  userId: string;
  scope: string | null;
  fact: string;
  factEmbedding: number[];
  category?: LearningCategory;
}

// Save a new cross-user fact. De-dupes exact fact matches on the same scope
// by bumping upvotes instead of inserting again.
export async function saveLearning(
  supabase: SupabaseClient,
  opts: SaveLearningOptions,
): Promise<SharedLearning | null> {
  const trimmed = opts.fact.trim();
  if (!trimmed) return null;

  const existing = await supabase
    .from("shared_learnings")
    .select("id, upvotes")
    .eq("scope", opts.scope)
    .eq("fact", trimmed)
    .eq("status", "active")
    .maybeSingle();

  if (existing.data) {
    const bumped = (existing.data.upvotes ?? 0) + 1;
    await supabase
      .from("shared_learnings")
      .update({ upvotes: bumped, updated_at: new Date().toISOString() })
      .eq("id", existing.data.id);
    return null;
  }

  const { data, error } = await supabase
    .from("shared_learnings")
    .insert({
      scope: opts.scope,
      fact: trimmed,
      fact_embedding: opts.factEmbedding,
      category: opts.category ?? "gotcha",
      created_by_user_id: opts.userId,
    })
    .select("id, scope, fact, category, upvotes")
    .single();
  if (error) return null;
  return rowToLearning(data as LearningRow);
}
