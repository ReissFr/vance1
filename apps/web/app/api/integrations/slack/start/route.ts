// Kick off Slack OAuth v2 install. Requests the bot scopes we need to run
// the SlackProvider's methods. The redirect_uri must exactly match the one
// registered on api.slack.com → Oauth & Permissions → Redirect URLs.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://slack.com/oauth/v2/authorize";

// Bot scopes — what the app can do in channels it's invited to.
const BOT_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "im:read",
  "im:history",
  "im:write",
  "mpim:read",
  "chat:write",
  "chat:write.public",
  "users:read",
  "users:read.email",
  "team:read",
];

// User scopes — optional, needed for search.messages (not bot-accessible).
const USER_SCOPES = ["search:read"];

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "SLACK_CLIENT_ID not set" }, { status: 500 });
  }

  const redirectUri = new URL(
    "/api/integrations/slack/callback",
    request.url,
  ).toString();
  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: BOT_SCOPES.join(","),
    user_scope: USER_SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("slack_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/slack",
    maxAge: 600,
  });
  return res;
}
