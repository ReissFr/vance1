// Passive fact extractor. Runs fire-and-forget after a conversation turn
// completes. A Haiku pass reads the (userMessage, assistantReply) pair and
// emits durable facts that the brain probably didn't bother to save_memory
// itself. Deduped against existing memories via embedding similarity so we
// don't accumulate 100 copies of "Reiss is building SevenPoint AI".

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_IDS, type MemoryKind } from "@jarvis/types";
import { saveMemory } from "./memory";

export interface ExtractedFact {
  kind: MemoryKind;
  content: string;
}

const EXTRACTOR_SYSTEM = `You extract durable facts about the user from a conversation turn. Output JSON only — an array of { "kind", "content" } objects.

Kinds:
- "fact": something true about the user (job, location, family, ownership, habits)
- "preference": taste/likes/dislikes ("only flies BA", "prefers afternoon meetings")
- "person": named people in the user's life with context ("Jamie = co-founder, Berlin-based")
- "event": scheduled/committed one-offs ("flying to Lisbon Thursday", "mum's birthday March 3")
- "task": things the user asked JARVIS to remember/do ("remind me to call dentist")

ONLY extract facts that are:
1. About the USER — their life, their people, their plans, their preferences. Not about the world.
2. Durable — likely to still be true in a week. Skip right-now ephemera ("I'm at the office").
3. Stated as fact by the user — not guesses, hypotheticals, or things JARVIS inferred.
4. New information — not trivially derivable from the user's name/email.

Write each fact as one short self-contained sentence in the third person ("User prefers afternoon meetings", "User's sister is Maya"). Do not reference the conversation.

Output [] if nothing qualifies. Max 5 facts per turn. JSON only — no prose, no markdown fences.`;

export async function extractFacts(
  anthropic: Anthropic,
  userMessage: string,
  assistantReply: string,
): Promise<ExtractedFact[]> {
  const res = await anthropic.messages.create({
    model: MODEL_IDS.haiku,
    max_tokens: 400,
    system: EXTRACTOR_SYSTEM,
    messages: [
      {
        role: "user",
        content: `USER: ${userMessage.slice(0, 1500)}\n\nASSISTANT: ${assistantReply.slice(0, 1500)}`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return [];
  const text = block.text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Haiku sometimes wraps in markdown despite instructions.
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const out: ExtractedFact[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { kind?: unknown; content?: unknown };
    if (
      typeof obj.kind === "string" &&
      ["fact", "preference", "person", "event", "task"].includes(obj.kind) &&
      typeof obj.content === "string" &&
      obj.content.trim().length > 0
    ) {
      out.push({
        kind: obj.kind as MemoryKind,
        content: obj.content.trim().slice(0, 1000),
      });
    }
  }
  return out.slice(0, 5);
}

// Save facts that aren't already known. Uses existing match_memories RPC —
// if the top match for this fact is >= threshold similar, we assume it's
// a duplicate and skip. Threshold 0.90 is tight (near-identical content);
// loosen if we see duplicates sneak through.
export async function saveFactsDedup(
  supabase: SupabaseClient,
  embed: (text: string) => Promise<number[]>,
  userId: string,
  facts: ExtractedFact[],
  opts?: { similarityThreshold?: number },
): Promise<{ saved: number; skipped: number }> {
  const threshold = opts?.similarityThreshold ?? 0.9;
  let saved = 0;
  let skipped = 0;
  for (const fact of facts) {
    try {
      const embedding = await embed(fact.content);
      const { data: matches } = await supabase.rpc("match_memories", {
        p_user_id: userId,
        p_query_embedding: embedding,
        p_match_count: 1,
      });
      const top = (matches ?? [])[0] as { similarity?: number } | undefined;
      if (top && typeof top.similarity === "number" && top.similarity >= threshold) {
        skipped++;
        continue;
      }
      await saveMemory(supabase, embed, {
        userId,
        kind: fact.kind,
        content: fact.content,
      });
      saved++;
    } catch (err) {
      console.warn("[memory-extractor] saveFactsDedup error:", err);
    }
  }
  return { saved, skipped };
}

export async function extractAndSaveFacts(
  anthropic: Anthropic,
  supabase: SupabaseClient,
  embed: (text: string) => Promise<number[]>,
  userId: string,
  userMessage: string,
  assistantReply: string,
): Promise<{ saved: number; skipped: number; extracted: number }> {
  const facts = await extractFacts(anthropic, userMessage, assistantReply);
  if (facts.length === 0) return { saved: 0, skipped: 0, extracted: 0 };
  const res = await saveFactsDedup(supabase, embed, userId, facts);
  return { ...res, extracted: facts.length };
}
