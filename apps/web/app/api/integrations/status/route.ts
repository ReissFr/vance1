// Light endpoint for the Settings UI to show which integrations are wired up.
// Intentionally minimal — shape: { banking: { connected, provider } }, add
// more kinds as the UI grows.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data } = await admin
    .from("integrations")
    .select("kind, provider, active")
    .eq("user_id", user.id)
    .eq("active", true);

  const banking = (data ?? []).find((r) => r.kind === "banking");
  return NextResponse.json({
    banking: {
      connected: !!banking,
      provider: banking?.provider ?? null,
    },
  });
}
