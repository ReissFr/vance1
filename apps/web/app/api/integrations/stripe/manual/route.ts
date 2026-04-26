// Store a user's Stripe secret key as their active payment integration.
// Minimal validation: must start with "sk_" and be callable (ping /v1/account).

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { secret_key?: string };
  try {
    body = (await req.json()) as { secret_key?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const secretKey = body.secret_key?.trim();
  if (!secretKey || !secretKey.startsWith("sk_")) {
    return NextResponse.json(
      { ok: false, error: "secret_key must start with sk_" },
      { status: 400 },
    );
  }

  const ping = await fetch("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!ping.ok) {
    return NextResponse.json(
      { ok: false, error: `stripe rejected the key (${ping.status})` },
      { status: 400 },
    );
  }
  const account = (await ping.json().catch(() => null)) as { email?: string; id?: string } | null;

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "payment",
      provider: "stripe",
      credentials: { secret_key: secretKey },
      metadata: { email: account?.email ?? null, account_id: account?.id ?? null },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
