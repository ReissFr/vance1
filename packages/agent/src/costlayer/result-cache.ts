import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CACHE_TTL_SECONDS, type CacheCategory, type CachedResult } from "./types";

// Heuristic category picker from the user message. Bias toward shorter TTLs
// when the question mentions live data or time-sensitive qualifiers.
export function classifyCache(userMessage: string): CacheCategory | null {
  const m = userMessage.toLowerCase();
  if (/\b(now|right now|current|live|latest|just now|at this moment)\b/.test(m)) return "minute";
  if (/\b(today|today's|tonight|this morning|this afternoon|this evening)\b/.test(m)) return "daily";
  if (/\b(this hour|past hour|last hour|recent|recently)\b/.test(m)) return "hourly";
  if (/\b(weather|price|cost|rate|score|inbox|unread|balance|open|closed)\b/.test(m)) {
    // Common live-data nouns with no time qualifier — still cache, but short.
    return "hourly";
  }
  if (/\b(what is|who is|when was|where is|how many|define|meaning of|capital of)\b/.test(m)) {
    return "static";
  }
  // If nothing matches, don't cache — safer to let the model compute fresh
  // than to return stale reasoning.
  return null;
}

function keyFor(userId: string, userMessage: string): string {
  const normalised = userMessage.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${userId}|${normalised}`).digest("hex").slice(0, 24);
}

interface CacheRow {
  id: string;
  key: string;
  answer: string;
  category: CacheCategory;
  expires_at: string;
  similarity: number;
}

// Try to serve this turn from the cache. Returns null if there's no hit.
// Does two lookups: exact key match (cheap), then semantic similarity via
// the match_result_cache RPC.
export async function lookupCached(
  supabase: SupabaseClient,
  args: {
    userId: string;
    userMessage: string;
    queryEmbedding: number[];
  },
): Promise<CachedResult | null> {
  const key = keyFor(args.userId, args.userMessage);
  const exact = await supabase
    .from("result_cache")
    .select("id, key, answer, category, expires_at")
    .eq("user_id", args.userId)
    .eq("key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (exact.data) {
    const row = exact.data as Omit<CacheRow, "similarity">;
    void bumpHit(supabase, row.id);
    return { ...row, id: row.id, similarity: 1, expiresAt: row.expires_at } as CachedResult;
  }

  const { data, error } = await supabase.rpc("match_result_cache", {
    p_user_id: args.userId,
    p_query_embedding: args.queryEmbedding,
    p_min_similarity: 0.88,
  });
  if (error) return null;
  const row = (data as CacheRow[] | null)?.[0];
  if (!row) return null;
  void bumpHit(supabase, row.id);
  return {
    id: row.id,
    key: row.key,
    answer: row.answer,
    category: row.category,
    expiresAt: row.expires_at,
    similarity: row.similarity,
  };
}

async function bumpHit(supabase: SupabaseClient, id: string): Promise<void> {
  // Best-effort — we don't care about the result.
  await supabase
    .from("result_cache")
    .update({ last_hit_at: new Date().toISOString() })
    .eq("id", id);
}

// Persist a fresh answer into the cache if the question looks cacheable.
// Returns the chosen category (for logging) or null when nothing was saved.
export async function saveCached(
  supabase: SupabaseClient,
  args: {
    userId: string;
    userMessage: string;
    queryEmbedding: number[];
    answer: string;
    category?: CacheCategory | null;
  },
): Promise<CacheCategory | null> {
  const category = args.category ?? classifyCache(args.userMessage);
  if (!category) return null;
  if (!args.answer.trim()) return null;

  const ttlSeconds = CACHE_TTL_SECONDS[category];
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const key = keyFor(args.userId, args.userMessage);

  await supabase
    .from("result_cache")
    .upsert(
      {
        user_id: args.userId,
        key,
        query_embedding: args.queryEmbedding,
        answer: args.answer,
        category,
        expires_at: expiresAt,
      },
      { onConflict: "user_id,key" },
    );

  return category;
}

// Delete expired rows. Called from a cron; safe to run as often as you like.
export async function evictExpired(supabase: SupabaseClient): Promise<void> {
  await supabase
    .from("result_cache")
    .delete()
    .lt("expires_at", new Date().toISOString());
}
