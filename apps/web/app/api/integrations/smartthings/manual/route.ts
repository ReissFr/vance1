// Store a user's SmartThings personal access token as their active home
// integration. Validates by pinging /devices.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { access_token?: string };
  try {
    body = (await req.json()) as { access_token?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const token = body.access_token?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "access_token required" }, { status: 400 });
  }

  const ping = await fetch("https://api.smartthings.com/v1/devices?max=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!ping.ok) {
    return NextResponse.json(
      { ok: false, error: `smartthings rejected the token (${ping.status})` },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "home",
      provider: "smartthings",
      credentials: { access_token: token },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
