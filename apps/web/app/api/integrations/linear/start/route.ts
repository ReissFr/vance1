// Start Linear OAuth2. Redirects the user to Linear for authorization and
// sets a state cookie for CSRF protection.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://linear.app/oauth/authorize";
const SCOPES = "read write";

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.LINEAR_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "LINEAR_CLIENT_ID not set" }, { status: 500 });
  }

  const redirectUri = new URL("/api/integrations/linear/callback", request.url).toString();
  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
    prompt: "consent",
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("linear_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/linear",
    maxAge: 600,
  });
  return res;
}
