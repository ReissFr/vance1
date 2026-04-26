// GitHub OAuth callback. Exchanges code for an access_token, then calls
// /user to grab the login + id for display. GitHub OAuth App tokens don't
// expire, so no refresh logic needed.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?github_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?github_error=missing_code", request.url));
  }

  const expected = request.cookies.get("github_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?github_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "GITHUB_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/github/callback",
    request.url,
  ).toString();

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[github/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?github_error=token_${tokenRes.status}`, request.url),
    );
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
  };
  if (!tokenJson.access_token) {
    return NextResponse.redirect(
      new URL(
        `/?github_error=${encodeURIComponent(tokenJson.error ?? "no_token")}`,
        request.url,
      ),
    );
  }

  // Look up the authed user's login for display.
  const userRes = await fetch(USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });
  const profile = userRes.ok
    ? ((await userRes.json()) as {
        login?: string;
        id?: number;
        email?: string | null;
        name?: string | null;
        avatar_url?: string | null;
      })
    : {};

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "dev",
      provider: "github",
      credentials: {
        access_token: tokenJson.access_token,
        login: profile.login ?? null,
        user_id: profile.id ?? null,
      },
      scopes: (tokenJson.scope ?? "").split(",").filter(Boolean),
      metadata: {
        login: profile.login ?? null,
        name: profile.name ?? null,
        avatar_url: profile.avatar_url ?? null,
        email: profile.email ?? null,
      },
    });
  } catch (e) {
    console.error("[github/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?github_error=db_upsert`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?github_connected=1", request.url));
  res.cookies.set("github_oauth_state", "", {
    path: "/api/integrations/github",
    maxAge: 0,
  });
  return res;
}
