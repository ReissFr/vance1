import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login", request.url));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }

  // Persist Google OAuth tokens. Dual-writes to:
  //   - profiles.google_* (legacy; still read by brain-run + synchronous
  //     calendar/gmail tools — remove once those are ported to integrations)
  //   - integrations (current; read by inbox_agent, writer+outreach approve)
  const providerToken = data.session.provider_token;
  const providerRefresh = data.session.provider_refresh_token;
  if (providerToken) {
    const admin = supabaseAdmin();
    const expiresAtIso = data.session.expires_at
      ? new Date(data.session.expires_at * 1000).toISOString()
      : null;

    await admin
      .from("profiles")
      .update({
        google_access_token: providerToken,
        google_refresh_token: providerRefresh ?? null,
        google_token_expires_at: expiresAtIso,
      })
      .eq("id", data.session.user.id);

    try {
      await upsertIntegration(admin, {
        userId: data.session.user.id,
        kind: "email",
        provider: "gmail",
        credentials: {
          access_token: providerToken,
          refresh_token: providerRefresh ?? null,
        },
        expiresAt: expiresAtIso,
      });
    } catch (e) {
      console.error("[auth/callback] integrations upsert failed", e);
    }
  }

  return NextResponse.redirect(new URL("/", request.url));
}
