// Start Google OAuth for Drive. Uses the same Google client id/secret as
// Gmail but requests only Drive scope so this is a distinct integration row.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID not set" }, { status: 500 });
  }

  const redirectUri = new URL(
    "/api/integrations/drive/callback",
    request.url,
  ).toString();
  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("drive_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/drive",
    maxAge: 600,
  });
  return res;
}
