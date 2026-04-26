// Kick off a FreeAgent OAuth2 authorization.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://api.freeagent.com/v2/approve_app";

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.FREEAGENT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "FREEAGENT_CLIENT_ID not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/freeagent/callback",
    request.url,
  ).toString();

  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("fa_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/freeagent",
    maxAge: 600,
  });
  return res;
}
