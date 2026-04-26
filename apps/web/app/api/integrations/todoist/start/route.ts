// Start Todoist OAuth2.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const AUTH_URL = "https://todoist.com/oauth/authorize";
const SCOPES = "data:read_write,data:delete,project:delete";

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.TODOIST_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "TODOIST_CLIENT_ID not set" }, { status: 500 });
  }

  const state = randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    state,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set("todoist_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/todoist",
    maxAge: 600,
  });
  return res;
}
