// Create a Plaid Link token. The browser uses this to open the Plaid Link
// widget; once the user selects their bank and authenticates, Plaid returns
// a public_token that we exchange at /callback.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
} as const;

export async function POST() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = (process.env.PLAID_ENV as keyof typeof HOSTS | undefined) ?? "production";
  if (!clientId || !secret) {
    return NextResponse.json(
      { error: "PLAID_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const body = {
    client_id: clientId,
    secret,
    client_name: "JARVIS",
    language: "en",
    country_codes: ["US", "GB", "CA", "IE", "FR", "ES", "NL", "DE"],
    user: { client_user_id: user.id },
    products: ["transactions"],
  };

  const res = await fetch(`${HOSTS[env]}/link/token/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[plaid/link-token] create failed", res.status, text);
    return NextResponse.json({ error: `plaid_${res.status}` }, { status: 500 });
  }

  const json = (await res.json()) as { link_token: string; expiration: string };
  return NextResponse.json({ ok: true, link_token: json.link_token, expiration: json.expiration });
}
