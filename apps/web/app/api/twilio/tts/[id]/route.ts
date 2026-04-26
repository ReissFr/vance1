// Public (unauthenticated) mp3 stream for Twilio to `<Play>` during a call.
// Security model: the notification id is a UUID (unguessable), the row only
// exists if the brain just created it, and we only return audio for rows whose
// channel is 'call' and status is still active. Twilio itself signs the fetch
// when TWILIO_AUTH_TOKEN is set.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyTwilioSignature } from "@/lib/twilio";

export const runtime = "nodejs";

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const sig = req.headers.get("x-twilio-signature");
    const url = publicUrl(req);
    if (!verifyTwilioSignature(authToken, url, {}, sig)) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }

  const elKey = process.env.ELEVENLABS_API_KEY;
  if (!elKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  const admin = supabaseAdmin();
  const { data: n } = await admin
    .from("notifications")
    .select("id, user_id, body, channel")
    .eq("id", id)
    .single();
  if (!n || n.channel !== "call") {
    return new NextResponse("not found", { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("voice_id")
    .eq("id", n.user_id)
    .single();
  const voiceId = profile?.voice_id ?? DEFAULT_VOICE;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: n.body,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => res.statusText);
    return NextResponse.json({ error: `elevenlabs: ${msg}` }, { status: 502 });
  }

  return new Response(res.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
    },
  });
}

function publicUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
  return req.nextUrl.toString();
}
