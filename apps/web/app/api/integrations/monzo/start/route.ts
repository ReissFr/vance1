// Kick off a Monzo OAuth authorization. Signed-in user hits this, gets
// bounced to Monzo's consent screen; on success, Monzo redirects back to
// /api/integrations/monzo/callback with a code we exchange.
//
// Note: Monzo requires the user to approve the app in the Monzo mobile app
// AFTER this flow completes (SCA). Until then, the access_token is
// restricted — listAccounts/listTransactions will return 403 until approval.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://auth.monzo.com/";

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.MONZO_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "MONZO_CLIENT_ID not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/monzo/callback",
    request.url,
  ).toString();

  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;
  const res = NextResponse.redirect(authUrl);
  res.cookies.set("monzo_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/monzo",
    maxAge: 600,
  });
  return res;
}
