// Exchange a Plaid public_token for a permanent access_token and store it.
// Called by the browser after Plaid Link succeeds.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
} as const;

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    public_token?: string;
    institution?: { name?: string; institution_id?: string };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const publicToken = body.public_token;
  if (!publicToken) {
    return NextResponse.json({ error: "public_token missing" }, { status: 400 });
  }

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = (process.env.PLAID_ENV as keyof typeof HOSTS | undefined) ?? "production";
  if (!clientId || !secret) {
    return NextResponse.json(
      { error: "PLAID_CLIENT_ID/SECRET not set" },
      { status: 500 },
    );
  }

  const exch = await fetch(`${HOSTS[env]}/item/public_token/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, public_token: publicToken }),
  });
  if (!exch.ok) {
    const text = await exch.text();
    console.error("[plaid/callback] exchange failed", exch.status, text);
    return NextResponse.json({ error: `plaid_${exch.status}` }, { status: 500 });
  }
  const exchJson = (await exch.json()) as { access_token: string; item_id: string };

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "banking",
      provider: "plaid",
      credentials: {
        access_token: exchJson.access_token,
        item_id: exchJson.item_id,
        institution_id: body.institution?.institution_id ?? null,
        institution_name: body.institution?.name ?? null,
      },
      metadata: {
        institution: body.institution?.name ?? null,
      },
    });
  } catch (e) {
    console.error("[plaid/callback] upsert failed", e);
    return NextResponse.json({ error: "db_upsert" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
