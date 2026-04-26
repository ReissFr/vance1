// Coinbase OAuth callback. Exchanges the auth code for access/refresh tokens
// and upserts them into public.integrations (kind=crypto, provider=coinbase).
// After this the CryptoProvider resolver hands back a working CoinbaseProvider.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://api.coinbase.com/oauth/token";
const ME_URL = "https://api.coinbase.com/v2/user";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?coinbase_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/?coinbase_error=missing_code", request.url),
    );
  }

  const expected = request.cookies.get("coinbase_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?coinbase_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.COINBASE_CLIENT_ID;
  const clientSecret = process.env.COINBASE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "COINBASE_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/coinbase/callback",
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
    console.error("[coinbase/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(
        `/?coinbase_error=${encodeURIComponent(`token_${tokenRes.status}`)}`,
        request.url,
      ),
    );
  }
  const json = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  };
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();

  // Best-effort: grab the user's email/name for the UI. Non-fatal if it fails.
  let displayEmail: string | null = null;
  let displayName: string | null = null;
  try {
    const meRes = await fetch(ME_URL, {
      headers: {
        Authorization: `Bearer ${json.access_token}`,
        "CB-VERSION": "2024-05-01",
      },
    });
    if (meRes.ok) {
      const meJson = (await meRes.json()) as { data?: { email?: string; name?: string } };
      displayEmail = meJson.data?.email ?? null;
      displayName = meJson.data?.name ?? null;
    }
  } catch (e) {
    console.warn("[coinbase/callback] /v2/user lookup failed", e);
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "crypto",
      provider: "coinbase",
      credentials: {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      },
      scopes: json.scope ? json.scope.split(/[,\s]+/).filter(Boolean) : null,
      expiresAt: expiresAt,
      metadata: {
        email: displayEmail,
        name: displayName,
      },
    });
  } catch (e) {
    console.error("[coinbase/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?coinbase_error=${encodeURIComponent("db_upsert")}`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?coinbase_connected=1", request.url));
  res.cookies.set("coinbase_oauth_state", "", {
    path: "/api/integrations/coinbase",
    maxAge: 0,
  });
  return res;
}
