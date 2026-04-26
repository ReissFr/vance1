// Linear OAuth callback. Exchanges code for access_token and fetches the
// viewer + default team so the provider can create issues without asking.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://api.linear.app/oauth/token";
const GQL_URL = "https://api.linear.app/graphql";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?linear_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?linear_error=missing_code", request.url));
  }

  const expected = request.cookies.get("linear_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?linear_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "LINEAR_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/linear/callback",
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
    console.error("[linear/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?linear_error=token_${tokenRes.status}`, request.url),
    );
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    scope?: string;
  };

  // Fetch viewer + default team for cached credentials.
  const viewerRes = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query { viewer { id name email } teams(first: 1) { nodes { id key name } } }`,
    }),
  });
  type ViewerJson = {
    data?: {
      viewer?: { id: string; name?: string; email?: string };
      teams?: { nodes?: Array<{ id: string; key?: string; name?: string }> };
    };
  };
  const viewerJson: ViewerJson = viewerRes.ok ? await viewerRes.json() : {};
  const viewer = viewerJson.data?.viewer;
  const team = viewerJson.data?.teams?.nodes?.[0];

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "tasks",
      provider: "linear",
      credentials: {
        access_token: tokenJson.access_token,
        default_team_id: team?.id ?? null,
        user_id: viewer?.id ?? null,
        user_email: viewer?.email ?? null,
        user_name: viewer?.name ?? null,
      },
      scopes: tokenJson.scope ? tokenJson.scope.split(/[\s,]+/) : null,
      metadata: {
        email: viewer?.email ?? null,
        name: viewer?.name ?? null,
        team_key: team?.key ?? null,
        team_name: team?.name ?? null,
      },
    });
  } catch (e) {
    console.error("[linear/callback] integrations upsert failed", e);
    return NextResponse.redirect(new URL(`/?linear_error=db_upsert`, request.url));
  }

  const res = NextResponse.redirect(new URL("/?linear_connected=1", request.url));
  res.cookies.set("linear_oauth_state", "", {
    path: "/api/integrations/linear",
    maxAge: 0,
  });
  return res;
}
