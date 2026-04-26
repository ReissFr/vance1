// User → browser machine resolver. Looks up the caller's provisioned
// browser backend from the `browser_machines` table (migration 0026) and
// returns the CDP URL / machine handle for the cloud providers. Falls back
// to env defaults (JARVIS_BROWSER, JARVIS_FLY_CDP_URL) when no row exists —
// keeps single-tenant scaffolds working unchanged.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface BrowserMachineRow {
  user_id: string;
  provider: "local" | "fly" | "browserbase";
  machine_id: string | null;
  cdp_url: string | null;
  volume_id: string | null;
}

function supabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function lookupBrowserMachine(
  userId: string | undefined,
): Promise<BrowserMachineRow | null> {
  if (!userId) return null;
  const client = supabaseAdmin();
  if (!client) return null;
  const { data, error } = await client
    .from("browser_machines")
    .select("user_id, provider, machine_id, cdp_url, volume_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as BrowserMachineRow;
}

export interface ResolvedEndpoint {
  provider: "local" | "fly" | "browserbase";
  cdpUrl?: string | null;
  machineId?: string | null;
}

// Called by provider implementations that need a remote endpoint (Fly,
// Browserbase). Returns the user-specific machine if one is provisioned,
// otherwise the env-level defaults — which is how the single-tenant
// scaffold keeps working.
export async function resolveUserEndpoint(
  userId: string | undefined,
): Promise<ResolvedEndpoint> {
  const row = await lookupBrowserMachine(userId);
  if (row) {
    return {
      provider: row.provider,
      cdpUrl: row.cdp_url,
      machineId: row.machine_id,
    };
  }
  const envProvider = (process.env.JARVIS_BROWSER ?? "local").toLowerCase();
  const cdpUrl = process.env.JARVIS_FLY_CDP_URL ?? null;
  return {
    provider: envProvider === "fly" || envProvider === "browserbase" ? envProvider : "local",
    cdpUrl,
    machineId: null,
  };
}
