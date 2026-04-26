// Store a user's PayPal REST API credentials as their payment integration.
// Validates by minting a client_credentials token before persisting —
// bad keys are rejected upfront.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const BASES = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com",
};

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { client_id?: string; client_secret?: string; env?: "live" | "sandbox" };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const clientId = body.client_id?.trim();
  const clientSecret = body.client_secret?.trim();
  const env = body.env === "sandbox" ? "sandbox" : "live";
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { ok: false, error: "client_id and client_secret required" },
      { status: 400 },
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const ping = await fetch(`${BASES[env]}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!ping.ok) {
    return NextResponse.json(
      { ok: false, error: `paypal rejected the keys (${ping.status})` },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "payment",
      provider: "paypal",
      credentials: { client_id: clientId, client_secret: clientSecret, env },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
