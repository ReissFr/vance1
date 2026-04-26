// FreeAgent OAuth callback.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://api.freeagent.com/v2/token_endpoint";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?fa_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?fa_error=missing_code", request.url));
  }

  const expected = request.cookies.get("fa_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?fa_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.FREEAGENT_CLIENT_ID;
  const clientSecret = process.env.FREEAGENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "FREEAGENT_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/freeagent/callback",
    request.url,
  ).toString();

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[fa/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?fa_error=${encodeURIComponent(`token_${tokenRes.status}`)}`, request.url),
    );
  }
  const json = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "accounting",
      provider: "freeagent",
      credentials: {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      },
      expiresAt,
    });
  } catch (e) {
    console.error("[fa/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?fa_error=${encodeURIComponent("db_upsert")}`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?fa_connected=1", request.url));
  res.cookies.set("fa_oauth_state", "", {
    path: "/api/integrations/freeagent",
    maxAge: 0,
  });
  return res;
}
