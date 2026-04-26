// Server-side helper: given a user id, return the set of brain tool names
// that are DISABLED for them based on the feature library + their overrides.
// Used by /api/agent (and cron jobs) to filter the brain's tool list.

import type { SupabaseClient } from "@supabase/supabase-js";
import { FEATURES } from "./features";

export async function disabledToolNamesForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data } = await admin
    .from("user_features")
    .select("feature_id, enabled")
    .eq("user_id", userId);
  const overrides = new Map<string, boolean>();
  for (const row of data ?? []) overrides.set(row.feature_id as string, row.enabled as boolean);

  const disabled: string[] = [];
  for (const f of FEATURES) {
    if (!f.toolIds || f.toolIds.length === 0) continue;
    const enabled = overrides.get(f.id) ?? f.defaultEnabled;
    if (!enabled) disabled.push(...f.toolIds);
  }
  return disabled;
}

export async function isFeatureEnabledForUser(
  admin: SupabaseClient,
  userId: string,
  featureId: string,
): Promise<boolean> {
  const f = FEATURES.find((x) => x.id === featureId);
  if (!f) return false;
  const { data } = await admin
    .from("user_features")
    .select("enabled")
    .eq("user_id", userId)
    .eq("feature_id", featureId)
    .maybeSingle();
  if (data && typeof data.enabled === "boolean") return data.enabled;
  return f.defaultEnabled;
}
