// Kick off a TrueLayer OAuth authorization. Signed-in user hits this, gets
// bounced to TrueLayer's bank-selection screen; on success, TrueLayer posts
// back to /api/integrations/truelayer/callback with a code we exchange.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_BASES = {
  live: "https://auth.truelayer.com",
  sandbox: "https://auth.truelayer-sandbox.com",
};

const SCOPES = [
  "info",
  "accounts",
  "balance",
  "transactions",
  "offline_access",
].join(" ");

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.TRUELAYER_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "TRUELAYER_CLIENT_ID not set" },
      { status: 500 },
    );
  }
  const env = (process.env.TRUELAYER_ENV === "sandbox" ? "sandbox" : "live") as
    | "live"
    | "sandbox";

  const redirectUri = new URL(
    "/api/integrations/truelayer/callback",
    request.url,
  ).toString();

  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    providers: env === "sandbox" ? "uk-cs-mock" : "uk-ob-all uk-oauth-all",
    state,
  });

  const authUrl = `${AUTH_BASES[env]}/?${params.toString()}`;
  console.log("[truelayer/start] auth url:", authUrl);
  const res = NextResponse.redirect(authUrl);
  res.cookies.set("tl_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/truelayer",
    maxAge: 600,
  });
  return res;
}
