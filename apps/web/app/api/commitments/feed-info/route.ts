// GET /api/commitments/feed-info → returns the user's iCal feed URL. Creates
// the token lazily on first call (so this endpoint is also the "give me my
// URL" action). POST rotates the token (invalidates any existing calendar
// subscription and returns a new URL — use when the old URL has leaked).

import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

function newToken(): string {
  // 32 bytes → 43-char base64url. Unguessable, url-safe.
  return crypto.randomBytes(32).toString("base64url");
}

function absoluteUrl(req: NextRequest, path: string): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return `${explicit.replace(/\/$/, "")}${path}`;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}${path}`;
}

async function ensureToken(userId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from("profiles")
    .select("ics_token")
    .eq("id", userId)
    .maybeSingle();
  if (existing?.ics_token) return existing.ics_token as string;
  const token = newToken();
  await admin.from("profiles").update({ ics_token: token }).eq("id", userId);
  return token;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = await ensureToken(user.id);
  return NextResponse.json({
    url: absoluteUrl(req, `/api/commitments/feed.ics?token=${token}`),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = newToken();
  const admin = supabaseAdmin();
  await admin.from("profiles").update({ ics_token: token }).eq("id", user.id);
  return NextResponse.json({
    url: absoluteUrl(req, `/api/commitments/feed.ics?token=${token}`),
  });
}
