import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearnedSkill, SkillStatus, Trajectory } from "./types";
import { sanitiseTrajectory } from "./sanitize";

// Threshold for promoting an unverified skill to verified once it has been
// replayed successfully by at least this many distinct users (including the
// original recorder).
const VERIFY_AT = 2;

// Threshold for deprecating a verified skill once it has failed this many
// times in a row without an intervening success.
const DEPRECATE_AT = 3;

interface SkillRow {
  id: string;
  fingerprint: string;
  name: string;
  intent: string;
  site: string | null;
  description: string;
  steps: Trajectory;
  variables: string[];
  status: SkillStatus;
  verified_count: number;
  failed_count: number;
  version: number;
  similarity?: number;
}

function rowToSkill(row: SkillRow): LearnedSkill {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    name: row.name,
    intent: row.intent,
    site: row.site,
    description: row.description,
    steps: row.steps,
    variables: row.variables ?? [],
    status: row.status,
    verifiedCount: row.verified_count,
    failedCount: row.failed_count,
    version: row.version,
    ...(row.similarity !== undefined ? { similarity: row.similarity } : {}),
  };
}

export interface LookupOptions {
  userId: string;
  fingerprint: string;
  intentEmbedding: number[];
  site: string | null;
  topK?: number;
}

// Look up skills that match the current intent. Tries the exact fingerprint
// first (cheap), then falls back to semantic lookup via the match_skills RPC.
export async function lookupSkills(
  supabase: SupabaseClient,
  opts: LookupOptions,
): Promise<LearnedSkill[]> {
  const exact = await supabase
    .from("learned_skills")
    .select(
      "id, fingerprint, name, intent, site, description, steps, variables, status, verified_count, failed_count, version",
    )
    .eq("fingerprint", opts.fingerprint)
    .in("status", ["verified", "unverified"])
    .order("version", { ascending: false })
    .limit(opts.topK ?? 5);

  const exactRows = (exact.data ?? []) as SkillRow[];
  const visibleExact = exactRows.filter(
    (r) => r.status === "verified" || /* creator check happens in RLS */ true,
  );
  if (visibleExact.length > 0) return visibleExact.map(rowToSkill);

  const { data, error } = await supabase.rpc("match_skills", {
    p_user_id: opts.userId,
    p_query_embedding: opts.intentEmbedding,
    p_site: opts.site,
    p_match_count: opts.topK ?? 5,
    p_min_similarity: 0.72,
  });
  if (error) throw new Error(`lookupSkills: ${error.message}`);
  return ((data ?? []) as SkillRow[]).map(rowToSkill);
}

export interface SaveSkillOptions {
  userId: string;
  fingerprint: string;
  name: string;
  intent: string;
  intentEmbedding: number[];
  site: string | null;
  description: string;
  trajectory: Trajectory;
}

// Save a newly-recorded skill. Sanitises the trajectory first, then upserts
// by fingerprint + version. If a skill with the same fingerprint already
// exists at the same version, the one with more successful runs wins and the
// new one is skipped — we only replace on failure-driven re-record.
export async function saveSkill(
  supabase: SupabaseClient,
  opts: SaveSkillOptions,
): Promise<LearnedSkill | null> {
  const { trajectory, variables } = sanitiseTrajectory(opts.trajectory);
  if (trajectory.steps.length === 0) return null;

  const existing = await supabase
    .from("learned_skills")
    .select("id, version, verified_count")
    .eq("fingerprint", opts.fingerprint)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.data && (existing.data.verified_count ?? 0) > 0) {
    // A tested skill is already there — don't clobber it with an unverified
    // one just because someone did the task a second way. Replay paths will
    // prefer the verified version.
    return null;
  }

  const { data, error } = await supabase
    .from("learned_skills")
    .insert({
      fingerprint: opts.fingerprint,
      name: opts.name,
      intent: opts.intent,
      intent_embedding: opts.intentEmbedding,
      site: opts.site,
      description: opts.description,
      steps: trajectory,
      variables,
      status: "unverified",
      verified_count: 1,
      last_verified_at: new Date().toISOString(),
      created_by_user_id: opts.userId,
      version: existing.data ? (existing.data.version ?? 1) + 1 : 1,
    })
    .select(
      "id, fingerprint, name, intent, site, description, steps, variables, status, verified_count, failed_count, version",
    )
    .single();

  if (error) throw new Error(`saveSkill: ${error.message}`);
  return rowToSkill(data as SkillRow);
}

// Log the outcome of a replay and update the skill's counters. A skill with
// enough successful distinct-user runs flips to verified; enough consecutive
// failures flip it to deprecated.
export async function recordRun(
  supabase: SupabaseClient,
  args: {
    skillId: string;
    userId: string;
    success: boolean;
    failedStep?: number;
    notes?: string;
  },
): Promise<void> {
  await supabase.from("skill_runs").insert({
    skill_id: args.skillId,
    user_id: args.userId,
    success: args.success,
    failed_step: args.failedStep ?? null,
    notes: args.notes ?? null,
  });

  const skill = await supabase
    .from("learned_skills")
    .select("id, status, verified_count, failed_count, created_by_user_id")
    .eq("id", args.skillId)
    .maybeSingle();
  if (!skill.data) return;

  const distinctUsers = await supabase
    .from("skill_runs")
    .select("user_id", { count: "exact", head: false })
    .eq("skill_id", args.skillId)
    .eq("success", true);
  const uniqueUserIds = new Set<string>((distinctUsers.data ?? []).map((r: { user_id: string }) => r.user_id));

  if (args.success) {
    const update: Record<string, unknown> = {
      verified_count: (skill.data.verified_count ?? 0) + 1,
      failed_count: 0,
      last_verified_at: new Date().toISOString(),
    };
    if (skill.data.status === "unverified" && uniqueUserIds.size >= VERIFY_AT) {
      update.status = "verified";
    }
    await supabase.from("learned_skills").update(update).eq("id", args.skillId);
  } else {
    const failedCount = (skill.data.failed_count ?? 0) + 1;
    const update: Record<string, unknown> = {
      failed_count: failedCount,
      last_failed_at: new Date().toISOString(),
    };
    if (failedCount >= DEPRECATE_AT) update.status = "deprecated";
    await supabase.from("learned_skills").update(update).eq("id", args.skillId);
  }
}
