// Deactivate a user's integration row. For Gmail/Google this also nulls the
// legacy profiles.google_* columns so nothing keeps reaching for stale tokens.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { kind?: string; provider?: string };
  try {
    body = (await req.json()) as { kind?: string; provider?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const { kind, provider } = body;
  if (!kind || !provider) {
    return NextResponse.json({ ok: false, error: "kind and provider required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("integrations")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("kind", kind)
    .eq("provider", provider);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (kind === "email" && provider === "gmail") {
    await admin
      .from("profiles")
      .update({
        google_access_token: null,
        google_refresh_token: null,
        google_token_expires_at: null,
      })
      .eq("id", user.id);
  }

  return NextResponse.json({ ok: true });
}
