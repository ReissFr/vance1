// Xero OAuth callback. Exchanges the code for access/refresh tokens,
// enumerates the authorized connections (Xero orgs the user chose to share),
// and persists an integrations row per-connection.
//
// Xero is multi-tenant: a single OAuth grant can cover multiple orgs. For
// now we store the FIRST tenant as the active connection; UI can let the
// user switch later.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?xero_error=${encodeURIComponent(oauthError)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?xero_error=missing_code", request.url));
  }

  const expected = request.cookies.get("xero_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL("/?xero_error=bad_state", request.url));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "XERO_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const redirectUri = new URL(
    "/api/integrations/xero/callback",
    request.url,
  ).toString();

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[xero/callback] token exchange failed", tokenRes.status, text);
    return NextResponse.redirect(
      new URL(`/?xero_error=${encodeURIComponent(`token_${tokenRes.status}`)}`, request.url),
    );
  }
  const json = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();

  // Enumerate tenants this grant covers.
  const connRes = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${json.access_token}`, Accept: "application/json" },
  });
  const connections = connRes.ok
    ? ((await connRes.json()) as { tenantId: string; tenantName?: string }[])
    : [];
  const firstTenant = connections[0];
  if (!firstTenant) {
    return NextResponse.redirect(new URL("/?xero_error=no_tenants", request.url));
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "accounting",
      provider: "xero",
      credentials: {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        tenant_id: firstTenant.tenantId,
        tenant_name: firstTenant.tenantName,
      },
      expiresAt,
      metadata: {
        tenant_name: firstTenant.tenantName ?? null,
        tenants: connections.map((c) => ({ id: c.tenantId, name: c.tenantName ?? null })),
      },
    });
  } catch (e) {
    console.error("[xero/callback] integrations upsert failed", e);
    return NextResponse.redirect(
      new URL(`/?xero_error=${encodeURIComponent("db_upsert")}`, request.url),
    );
  }

  const res = NextResponse.redirect(new URL("/?xero_connected=1", request.url));
  res.cookies.set("xero_oauth_state", "", {
    path: "/api/integrations/xero",
    maxAge: 0,
  });
  return res;
}
