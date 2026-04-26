// Manual Cal.com connection. User generates a personal API key on
// Cal.com → Settings → Developer → API Keys and pastes it here. We ping
// /me to verify the key works + pull the username for link-building.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const API = "https://api.cal.com/v1";

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { api_key?: string };
  const apiKey = body.api_key?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "api_key required" }, { status: 400 });
  }
  if (!apiKey.startsWith("cal_")) {
    return NextResponse.json(
      { ok: false, error: "api_key should start with cal_" },
      { status: 400 },
    );
  }

  // Verify the key works.
  const meRes = await fetch(
    `${API}/me?apiKey=${encodeURIComponent(apiKey)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!meRes.ok) {
    const text = await meRes.text();
    return NextResponse.json(
      { ok: false, error: `Cal.com rejected the key (${meRes.status}): ${text.slice(0, 200)}` },
      { status: 400 },
    );
  }
  const me = (await meRes.json()) as {
    user?: { username?: string; email?: string; name?: string };
  };
  const username = me.user?.username ?? null;

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "calendar",
      provider: "calcom",
      credentials: {
        api_key: apiKey,
        username,
      },
      metadata: {
        username,
        email: me.user?.email ?? null,
        name: me.user?.name ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
