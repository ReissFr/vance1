// Todoist OAuth callback. Tokens don't expire.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://todoist.com/oauth/access_token";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?todoist_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?todoist_error=missing_code", request.url));
  }

  const expected = request.cookies.get("todoist_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?todoist_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.TODOIST_CLIENT_ID;
  const clientSecret = process.env.TODOIST_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "TODOIST_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[todoist/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?todoist_error=token_${tokenRes.status}`, request.url),
    );
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
  };

  // Fetch user profile via /sync for email/name.
  const profileRes = await fetch("https://api.todoist.com/sync/v9/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      sync_token: "*",
      resource_types: '["user"]',
    }).toString(),
  });
  type ProfileJson = {
    user?: { id?: string | number; email?: string; full_name?: string };
  };
  const profile: ProfileJson = profileRes.ok ? await profileRes.json() : {};
  const userProfile = profile.user;

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "tasks",
      provider: "todoist",
      credentials: {
        access_token: tokenJson.access_token,
        user_id: userProfile?.id ? String(userProfile.id) : null,
        user_email: userProfile?.email ?? null,
      },
      metadata: {
        email: userProfile?.email ?? null,
        name: userProfile?.full_name ?? null,
      },
    });
  } catch (e) {
    console.error("[todoist/callback] integrations upsert failed", e);
    return NextResponse.redirect(new URL(`/?todoist_error=db_upsert`, request.url));
  }

  const res = NextResponse.redirect(new URL("/?todoist_connected=1", request.url));
  res.cookies.set("todoist_oauth_state", "", {
    path: "/api/integrations/todoist",
    maxAge: 0,
  });
  return res;
}
