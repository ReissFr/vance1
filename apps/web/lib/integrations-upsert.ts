// Shared upsert helper for OAuth callbacks and manual-key flows. Wraps the
// integrations table insert with two things every caller needs:
//   1. `is_default = true` on the first row of a given (user, kind) pair, so
//      the resolver has a deterministic pick when callers don't specify a
//      provider. Later rows of the same kind default to false — the user
//      promotes one via the UI if they want to switch.
//   2. `onConflict: user_id,kind,provider` so re-connecting the same provider
//      refreshes tokens without duplicating rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationKind } from "@jarvis/integrations";

export type UpsertIntegrationInput = {
  userId: string;
  kind: IntegrationKind;
  provider: string;
  credentials: Record<string, unknown>;
  scopes?: string[] | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};

export async function upsertIntegration(
  admin: SupabaseClient,
  input: UpsertIntegrationInput,
): Promise<void> {
  const { data: existing, error: existingErr } = await admin
    .from("integrations")
    .select("id, provider, is_default")
    .eq("user_id", input.userId)
    .eq("kind", input.kind)
    .eq("active", true);
  if (existingErr) {
    throw new Error(
      `Failed to check existing ${input.kind} integrations: ${existingErr.message}`,
    );
  }

  // Mark as default if this is the user's first active row of this kind, or
  // if the only existing row is this same provider being re-connected.
  const othersOfKind = (existing ?? []).filter((r) => r.provider !== input.provider);
  const existingSameProvider = (existing ?? []).find((r) => r.provider === input.provider);
  const anyExistingDefault = (existing ?? []).some((r) => r.is_default);
  const isDefault =
    othersOfKind.length === 0 ||
    (existingSameProvider?.is_default ?? false) ||
    !anyExistingDefault;

  const { error: upsertErr } = await admin.from("integrations").upsert(
    {
      user_id: input.userId,
      kind: input.kind,
      provider: input.provider,
      credentials: input.credentials,
      scopes: input.scopes ?? null,
      expires_at: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
      active: true,
      is_default: isDefault,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,kind,provider" },
  );
  if (upsertErr) {
    throw new Error(
      `Failed to upsert ${input.kind}/${input.provider} integration: ${upsertErr.message}`,
    );
  }
}
