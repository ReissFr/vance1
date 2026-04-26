// Kick off a QuickBooks OAuth2 authorization (Intuit).

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";

const SCOPES = ["com.intuit.quickbooks.accounting", "openid", "profile", "email"];

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "QUICKBOOKS_CLIENT_ID not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/quickbooks/callback",
    request.url,
  ).toString();

  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("qb_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/quickbooks",
    maxAge: 600,
  });
  return res;
}
