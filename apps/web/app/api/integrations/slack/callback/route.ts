// Slack OAuth v2 callback. Exchanges code for bot+user tokens. Bot tokens
// don't expire (unless token rotation is enabled on the app — we don't).

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://slack.com/api/oauth.v2.access";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?slack_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?slack_error=missing_code", request.url));
  }

  const expected = request.cookies.get("slack_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?slack_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "SLACK_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/slack/callback",
    request.url,
  ).toString();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[slack/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?slack_error=token_${tokenRes.status}`, request.url),
    );
  }
  const json = (await tokenRes.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string; // bot token
    token_type?: string;
    scope?: string;
    bot_user_id?: string;
    app_id?: string;
    team?: { id?: string; name?: string };
    authed_user?: { id?: string; access_token?: string; scope?: string };
  };
  if (!json.ok || !json.access_token) {
    return NextResponse.redirect(
      new URL(
        `/?slack_error=${encodeURIComponent(json.error ?? "no_token")}`,
        request.url,
      ),
    );
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "messaging",
      provider: "slack",
      credentials: {
        bot_token: json.access_token,
        user_token: json.authed_user?.access_token ?? null,
        team_id: json.team?.id ?? null,
        team_name: json.team?.name ?? null,
        bot_user_id: json.bot_user_id ?? null,
        authed_user_id: json.authed_user?.id ?? null,
      },
      scopes: (json.scope ?? "").split(",").filter(Boolean),
      metadata: {
        team_name: json.team?.name ?? null,
        team_id: json.team?.id ?? null,
      },
    });
  } catch (e) {
    console.error("[slack/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?slack_error=db_upsert`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?slack_connected=1", request.url));
  res.cookies.set("slack_oauth_state", "", {
    path: "/api/integrations/slack",
    maxAge: 0,
  });
  return res;
}
