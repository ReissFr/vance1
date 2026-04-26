// Monzo OAuth callback. Exchanges the auth code for access/refresh tokens
// and upserts them into public.integrations (kind=banking, provider=monzo).
// After this the BankingProvider resolver hands back a working MonzoProvider.
//
// User still needs to open the Monzo app and approve the grant before
// listAccounts/listTransactions will return data (SCA gating).

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://api.monzo.com/oauth2/token";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?monzo_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?monzo_error=missing_code", request.url));
  }

  const expected = request.cookies.get("monzo_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?monzo_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.MONZO_CLIENT_ID;
  const clientSecret = process.env.MONZO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "MONZO_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/monzo/callback",
    request.url,
  ).toString();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[monzo/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(
        `/?monzo_error=${encodeURIComponent(`token_${tokenRes.status}`)}`,
        request.url,
      ),
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
      kind: "banking",
      provider: "monzo",
      credentials: {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      },
      expiresAt: expiresAt,
    });
  } catch (e) {
    console.error("[monzo/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?monzo_error=${encodeURIComponent("db_upsert")}`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?monzo_connected=1", request.url));
  res.cookies.set("monzo_oauth_state", "", {
    path: "/api/integrations/monzo",
    maxAge: 0,
  });
  return res;
}
