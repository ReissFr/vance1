// Kick off a Coinbase OAuth authorization. Signed-in user hits this, gets
// bounced to Coinbase's consent screen; on success, Coinbase redirects back
// to /api/integrations/coinbase/callback with a code we exchange.
//
// Scopes: read-only (accounts/transactions/user) plus wallet:transactions:send
// so JARVIS can initiate sends after a WhatsApp approval. All sends still go
// through the whitelist (JARVIS side) AND Coinbase's own 2FA (upstream side).
// Send-amount limits are not part of this scope list — Coinbase enforces
// those per-user on their side.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://www.coinbase.com/oauth/authorize";

const SCOPES = [
  "wallet:accounts:read",
  "wallet:transactions:read",
  "wallet:transactions:send",
  "wallet:user:read",
  "wallet:user:email",
];

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.COINBASE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "COINBASE_CLIENT_ID not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/coinbase/callback",
    request.url,
  ).toString();

  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
    // "all" means all wallets; default is just the primary.
    account: "all",
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;
  const res = NextResponse.redirect(authUrl);
  res.cookies.set("coinbase_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/coinbase",
    maxAge: 600,
  });
  return res;
}
