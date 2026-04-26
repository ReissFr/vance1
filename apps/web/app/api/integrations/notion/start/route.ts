// Kick off a Notion OAuth2 authorization. Uses the "public integration"
// flow so we need NOTION_CLIENT_ID + NOTION_CLIENT_SECRET. The user lands on
// Notion, picks which pages/databases to share, and is redirected back to
// /api/integrations/notion/callback with ?code=&state=.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://api.notion.com/v1/oauth/authorize";

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "NOTION_CLIENT_ID not set" }, { status: 500 });
  }

  const redirectUri = new URL(
    "/api/integrations/notion/callback",
    request.url,
  ).toString();
  const state = randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    owner: "user",
    state,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("notion_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/notion",
    maxAge: 600,
  });
  return res;
}
