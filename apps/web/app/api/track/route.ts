import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";

interface TrackPayload {
  event: string;
  path?: string;
  properties?: Record<string, unknown>;
  sessionId?: string;
  anonymousId?: string;
}

export async function POST(req: NextRequest) {
  let body: TrackPayload;
  try {
    body = (await req.json()) as TrackPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.event) return NextResponse.json({ error: "missing event" }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  await trackEvent(body.event, {
    userId: user?.id ?? null,
    anonymousId: body.anonymousId ?? null,
    path: body.path ?? null,
    properties: body.properties,
    sessionId: body.sessionId ?? null,
    source: "web",
  });

  return NextResponse.json({ ok: true });
}
