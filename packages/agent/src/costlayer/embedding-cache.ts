import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// In-process LRU so a single brain turn can embed the same string multiple
// times for free (cache check, skill lookup, learnings lookup all share the
// same user message).
const LOCAL_LRU = new Map<string, number[]>();
const LOCAL_LRU_MAX = 512;

function hashText(text: string, model: string): string {
  return createHash("sha256").update(`${model}|${text}`).digest("hex");
}

function rememberLocal(hash: string, embedding: number[]): void {
  if (LOCAL_LRU.size >= LOCAL_LRU_MAX) {
    const firstKey = LOCAL_LRU.keys().next().value;
    if (firstKey) LOCAL_LRU.delete(firstKey);
  }
  LOCAL_LRU.set(hash, embedding);
}

// Wrap a raw embedder so (a) duplicate calls within the process are free,
// (b) previously computed embeddings in Supabase are reused globally. Writes
// back to Supabase on a miss so other processes benefit.
export function makeCachedEmbed(
  supabase: SupabaseClient,
  raw: (text: string) => Promise<number[]>,
  model = "voyage-3",
): (text: string) => Promise<number[]> {
  return async (text: string) => {
    const hash = hashText(text, model);

    const local = LOCAL_LRU.get(hash);
    if (local) return local;

    try {
      const { data } = await supabase
        .from("embedding_cache")
        .select("embedding")
        .eq("hash", hash)
        .maybeSingle();
      if (data?.embedding) {
        const v = data.embedding as unknown as number[];
        rememberLocal(hash, v);
        // Bump hits asynchronously — we don't care if it fails.
        void supabase
          .from("embedding_cache")
          .update({ last_hit_at: new Date().toISOString(), hits: 1 })
          .eq("hash", hash)
          .then(() => undefined);
        return v;
      }
    } catch {
      // Fall through to raw embed.
    }

    const embedding = await raw(text);
    rememberLocal(hash, embedding);

    void supabase
      .from("embedding_cache")
      .upsert(
        { hash, embedding, model, last_hit_at: new Date().toISOString() },
        { onConflict: "hash" },
      )
      .then(() => undefined);

    return embedding;
  };
}
