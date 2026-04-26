// Manual API-key setup for Resend. No OAuth flow is offered by Resend, so
// the user pastes their API key plus an optional "default from" address.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { api_key?: string; default_from?: string; domain?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const apiKey = (body.api_key ?? "").trim();
  if (!apiKey.startsWith("re_")) {
    return NextResponse.json(
      { error: "Resend API keys start with 're_'. Generate one at resend.com/api-keys." },
      { status: 400 },
    );
  }

  // Ping /domains to verify the key is valid.
  const ping = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!ping.ok) {
    return NextResponse.json(
      { error: `Resend API rejected key (${ping.status})` },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "transactional",
      provider: "resend",
      credentials: {
        api_key: apiKey,
        default_from: body.default_from?.trim() || null,
        domain: body.domain?.trim() || null,
      },
      metadata: {
        default_from: body.default_from?.trim() || null,
        domain: body.domain?.trim() || null,
      },
    });
  } catch (e) {
    console.error("[resend/manual] upsert failed", e);
    return NextResponse.json({ error: "db_upsert" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
