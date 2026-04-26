// QuickBooks OAuth callback. Exchanges code for tokens; Intuit also appends
// `realmId` to the redirect — that's the company ID we pin against.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?qb_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code || !realmId) {
    return NextResponse.redirect(
      new URL("/?qb_error=missing_code_or_realm", request.url),
    );
  }

  const expected = request.cookies.get("qb_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?qb_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "QUICKBOOKS_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }
  const env = process.env.QUICKBOOKS_ENV === "sandbox" ? "sandbox" : "live";

  const redirectUri = new URL(
    "/api/integrations/quickbooks/callback",
    request.url,
  ).toString();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[qb/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?qb_error=${encodeURIComponent(`token_${tokenRes.status}`)}`, request.url),
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
      provider: "quickbooks",
      credentials: {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        realm_id: realmId,
        env,
      },
      expiresAt,
      metadata: { realm_id: realmId, env },
    });
  } catch (e) {
    console.error("[qb/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?qb_error=${encodeURIComponent("db_upsert")}`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?qb_connected=1", request.url));
  res.cookies.set("qb_oauth_state", "", {
    path: "/api/integrations/quickbooks",
    maxAge: 0,
  });
  return res;
}
