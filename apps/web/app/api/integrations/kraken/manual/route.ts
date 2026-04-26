// Store a user's Kraken API key + secret as their active crypto integration.
// Validates by hitting /0/private/Balance with the supplied creds before
// persisting — bad keys are rejected upfront rather than failing the first
// time the brain asks for wallets.

import { createHash, createHmac } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { api_key?: string; api_secret?: string };
  try {
    body = (await req.json()) as { api_key?: string; api_secret?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const apiKey = body.api_key?.trim();
  const apiSecret = body.api_secret?.trim();
  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { ok: false, error: "api_key and api_secret required" },
      { status: 400 },
    );
  }

  const ping = await krakenPing(apiKey, apiSecret);
  if (!ping.ok) {
    return NextResponse.json(
      { ok: false, error: `kraken rejected the keys: ${ping.error}` },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "crypto",
      provider: "kraken",
      credentials: { api_key: apiKey, api_secret: apiSecret },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

async function krakenPing(
  apiKey: string,
  apiSecretB64: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const path = "/0/private/Balance";
  const nonce = Date.now().toString() + Math.floor(Math.random() * 1000).toString();
  const postData = new URLSearchParams({ nonce }).toString();

  const sha = createHash("sha256").update(nonce + postData).digest();
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(apiSecretB64, "base64");
  } catch {
    return { ok: false, error: "api_secret is not valid base64" };
  }
  const hmac = createHmac("sha512", secretBytes);
  hmac.update(path);
  hmac.update(sha);
  const signature = hmac.digest("base64");

  try {
    const res = await fetch(`https://api.kraken.com${path}`, {
      method: "POST",
      headers: {
        "API-Key": apiKey,
        "API-Sign": signature,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: postData,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { error?: string[] };
    if (json.error?.length) {
      return { ok: false, error: json.error.join(", ") };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
