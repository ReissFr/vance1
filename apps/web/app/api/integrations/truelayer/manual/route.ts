// Fallback for when the TrueLayer OAuth flow is broken (sandbox flakiness) or
// when we want to paste a pre-existing token. Accepts the raw JSON response
// from TrueLayer's /connect/token endpoint (or any bearer token + refresh +
// expires_in) and upserts it into integrations exactly like the OAuth callback.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

interface Body {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { access_token, refresh_token, expires_in } = body;
  if (!access_token || typeof access_token !== "string") {
    return NextResponse.json(
      { error: "access_token required" },
      { status: 400 },
    );
  }
  if (!refresh_token || typeof refresh_token !== "string") {
    return NextResponse.json(
      { error: "refresh_token required" },
      { status: 400 },
    );
  }
  const ttl = typeof expires_in === "number" && expires_in > 0 ? expires_in : 3600;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "banking",
      provider: "truelayer",
      credentials: { access_token, refresh_token },
      expiresAt: expiresAt,
    });
  } catch (e) {
    console.error("[truelayer/manual] integrations upsert failed", e);
    return NextResponse.json({ error: "db_upsert" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
