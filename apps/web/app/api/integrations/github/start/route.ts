// Kick off GitHub OAuth2 authorization. Uses the "OAuth App" flow (not
// GitHub App), which gives us a user-scoped token good for repo + notifications
// access. No refresh — tokens last until the user revokes.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://github.com/login/oauth/authorize";

// Scopes cover public+private repo read/write (issues, PRs, comments) and
// notifications. `read:user` lets us fetch the authed user's login.
const SCOPES = ["repo", "notifications", "read:user", "read:org"];

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GITHUB_CLIENT_ID not set" }, { status: 500 });
  }

  const redirectUri = new URL(
    "/api/integrations/github/callback",
    request.url,
  ).toString();
  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    allow_signup: "false",
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("github_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/github",
    maxAge: 600,
  });
  return res;
}
