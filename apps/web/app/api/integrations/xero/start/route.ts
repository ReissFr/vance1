// Kick off a Xero OAuth2 authorization. PKCE is not required for Xero's
// confidential client flow (we have a client secret), so we just use state.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://login.xero.com/identity/connect/authorize";

// offline_access is required to receive a refresh_token.
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.reports.read",
];

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.XERO_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "XERO_CLIENT_ID not set" }, { status: 500 });
  }

  const redirectUri = new URL(
    "/api/integrations/xero/callback",
    request.url,
  ).toString();

  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("xero_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/xero",
    maxAge: 600,
  });
  return res;
}
