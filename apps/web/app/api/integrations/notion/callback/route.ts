// Notion OAuth callback. Exchanges code for an access_token + workspace
// metadata and stores both. Notion tokens don't expire, so no refresh flow.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://api.notion.com/v1/oauth/token";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?notion_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?notion_error=missing_code", request.url));
  }

  const expected = request.cookies.get("notion_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?notion_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "NOTION_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/notion/callback",
    request.url,
  ).toString();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[notion/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?notion_error=token_${tokenRes.status}`, request.url),
    );
  }
  const json = (await tokenRes.json()) as {
    access_token: string;
    bot_id?: string;
    workspace_id?: string;
    workspace_name?: string;
    workspace_icon?: string;
    owner?: { user?: { person?: { email?: string }; name?: string } };
  };

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "productivity",
      provider: "notion",
      credentials: {
        access_token: json.access_token,
        workspace_id: json.workspace_id ?? null,
        workspace_name: json.workspace_name ?? null,
        bot_id: json.bot_id ?? null,
      },
      metadata: {
        workspace_name: json.workspace_name ?? null,
        workspace_icon: json.workspace_icon ?? null,
        email: json.owner?.user?.person?.email ?? null,
        owner_name: json.owner?.user?.name ?? null,
      },
    });
  } catch (e) {
    console.error("[notion/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?notion_error=db_upsert`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?notion_connected=1", request.url));
  res.cookies.set("notion_oauth_state", "", {
    path: "/api/integrations/notion",
    maxAge: 0,
  });
  return res;
}
