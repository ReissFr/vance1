import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

interface TtsBody {
  text: string;
  voice_id?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as TtsBody;
  if (!body.text?.trim()) return NextResponse.json({ error: "empty text" }, { status: 400 });

  const elKey = process.env.ELEVENLABS_API_KEY;
  if (!elKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  let voiceId = body.voice_id;
  if (!voiceId) {
    const { data: profile } = await supabaseAdmin()
      .from("profiles")
      .select("voice_id")
      .eq("id", user.id)
      .single();
    voiceId = profile?.voice_id ?? DEFAULT_VOICE;
  }

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
        text: body.text,
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
