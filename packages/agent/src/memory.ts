import type { SupabaseClient } from "@supabase/supabase-js";
import type { Memory, MemoryKind } from "@jarvis/types";

export interface RecallOptions {
  userId: string;
  query: string;
  topK?: number;
}

export async function recallMemories(
  supabase: SupabaseClient,
  embed: (text: string) => Promise<number[]>,
  opts: RecallOptions,
): Promise<Memory[]> {
  const embedding = await embed(opts.query);
  const { data, error } = await supabase.rpc("match_memories", {
    p_user_id: opts.userId,
    p_query_embedding: embedding,
    p_match_count: opts.topK ?? 6,
  });
  if (error) throw new Error(`recallMemories: ${error.message}`);
  return (data ?? []) as Memory[];
}

export interface SaveOptions {
  userId: string;
  kind: MemoryKind;
  content: string;
  sourceMessageId?: string;
}

export async function saveMemory(
  supabase: SupabaseClient,
  embed: (text: string) => Promise<number[]>,
  opts: SaveOptions,
): Promise<Memory> {
  const embedding = await embed(opts.content);
  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: opts.userId,
      kind: opts.kind,
      content: opts.content,
      embedding,
      source_message_id: opts.sourceMessageId ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`saveMemory: ${error.message}`);
  return data as Memory;
}

// Fetch the N most-recently-saved memories regardless of semantic match.
// Used alongside recallMemories so the brain always sees "what did the user
// tell us recently" even when today's message is on a different topic.
export async function recentMemories(
  supabase: SupabaseClient,
  userId: string,
  limit = 3,
): Promise<Memory[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("id, user_id, kind, content, source_message_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recentMemories: ${error.message}`);
  return (data ?? []) as Memory[];
}

// Fetch all pinned memories for a user. These ride along in the brain's
// context unconditionally — the user has explicitly flagged them as "always
// relevant" (identity facts, hard constraints, allergies, preferred-name).
// Cap at 40 so a runaway pin spree can't blow the prompt out.
export async function pinnedMemories(
  supabase: SupabaseClient,
  userId: string,
  limit = 40,
): Promise<Memory[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("id, user_id, kind, content, source_message_id, created_at")
    .eq("user_id", userId)
    .eq("pinned", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`pinnedMemories: ${error.message}`);
  return (data ?? []) as Memory[];
}
