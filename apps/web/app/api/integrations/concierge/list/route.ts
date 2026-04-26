// Lists the user's concierge paired sessions + their current autonomous
// spend limit. Used by the Settings UI.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { SITE_PRESETS } from "@/lib/concierge-pair";

export const runtime = "nodejs";

interface CredBag {
  display_name?: string;
  domain?: string;
  storage_state?: { cookies?: unknown[]; origins?: unknown[] };
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();

  const [{ data: sessions }, { data: profile }] = await Promise.all([
    admin
      .from("integrations")
      .select("provider, credentials, updated_at")
      .eq("user_id", user.id)
      .eq("kind", "concierge_session")
      .eq("active", true)
      .order("updated_at", { ascending: false }),
    admin
      .from("profiles")
      .select("concierge_auto_limit_gbp")
      .eq("id", user.id)
      .single(),
  ]);

  const paired = (sessions ?? []).map((row) => {
    const c = (row.credentials ?? {}) as CredBag;
    return {
      provider: row.provider,
      display_name: c.display_name ?? row.provider,
      domain: c.domain ?? row.provider,
      cookie_count: c.storage_state?.cookies?.length ?? 0,
      updated_at: row.updated_at,
    };
  });

  return NextResponse.json({
    paired,
    presets: Object.values(SITE_PRESETS).map(({ id, name, domain }) => ({ id, name, domain })),
    auto_limit_gbp: Number(profile?.concierge_auto_limit_gbp ?? 0),
  });
}
