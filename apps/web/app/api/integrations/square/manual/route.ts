// Store a user's Square personal access token as their payment integration.
// Validates by calling /v2/locations before persisting.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const BASES = {
  live: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { access_token?: string; env?: "live" | "sandbox" };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const token = body.access_token?.trim();
  const env = body.env === "sandbox" ? "sandbox" : "live";
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "access_token required" },
      { status: 400 },
    );
  }

  const ping = await fetch(`${BASES[env]}/v2/locations`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": "2025-01-23",
      Accept: "application/json",
    },
  });
  if (!ping.ok) {
    return NextResponse.json(
      { ok: false, error: `square rejected the token (${ping.status})` },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "payment",
      provider: "square",
      credentials: { access_token: token, env },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
