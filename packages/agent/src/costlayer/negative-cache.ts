import type { SupabaseClient } from "@supabase/supabase-js";

export interface SkillFailure {
  id: string;
  fingerprint: string;
  site: string | null;
  reason: string;
  skillId: string | null;
}

interface FailureRow {
  id: string;
  fingerprint: string;
  site: string | null;
  reason: string;
  skill_id: string | null;
  expires_at: string;
}

function rowToFailure(row: FailureRow): SkillFailure {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    site: row.site,
    reason: row.reason,
    skillId: row.skill_id,
  };
}

// Fetch known-bad approaches for this intent + site. Surfaced to the brain
// so it doesn't repeat the same mistake. Exact-match only — we want high
// precision here (a false positive would wrongly forbid a good approach).
export async function lookupFailures(
  supabase: SupabaseClient,
  args: { fingerprint: string; site: string | null; limit?: number },
): Promise<SkillFailure[]> {
  let q = supabase
    .from("skill_failures")
    .select("id, fingerprint, site, reason, skill_id, expires_at")
    .eq("fingerprint", args.fingerprint)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 5);
  if (args.site) q = q.or(`site.eq.${args.site},site.is.null`);
  else q = q.is("site", null);
  const { data, error } = await q;
  if (error) return [];
  return ((data ?? []) as FailureRow[]).map(rowToFailure);
}

export async function saveFailure(
  supabase: SupabaseClient,
  args: {
    userId: string;
    fingerprint: string;
    site: string | null;
    reason: string;
    skillId?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from("skill_failures").insert({
      fingerprint: args.fingerprint,
      site: args.site,
      reason: args.reason.slice(0, 500),
      skill_id: args.skillId ?? null,
      created_by_user_id: args.userId,
    });
  } catch { /* non-fatal */ }
}
