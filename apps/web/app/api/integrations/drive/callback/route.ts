// Google Drive OAuth callback.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?drive_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?drive_error=missing_code", request.url));
  }

  const expected = request.cookies.get("drive_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?drive_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/drive/callback",
    request.url,
  ).toString();

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[drive/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?drive_error=token_${tokenRes.status}`, request.url),
    );
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  let email: string | null = null;
  try {
    const infoRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { email?: string };
      email = info.email ?? null;
    }
  } catch {
    // Non-fatal — we just don't get the email for the card.
  }

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "files",
      provider: "google_drive",
      credentials: {
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token ?? null,
        email,
      },
      scopes: tokenJson.scope ? tokenJson.scope.split(/\s+/) : null,
      expiresAt,
      metadata: {
        email,
      },
    });
  } catch (e) {
    console.error("[drive/callback] integrations upsert failed", e);
    return NextResponse.redirect(new URL(`/?drive_error=db_upsert`, request.url));
  }

  const res = NextResponse.redirect(new URL("/?drive_connected=1", request.url));
  res.cookies.set("drive_oauth_state", "", {
    path: "/api/integrations/drive",
    maxAge: 0,
  });
  return res;
}
