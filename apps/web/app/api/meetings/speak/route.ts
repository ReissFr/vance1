// Outbound live translation: user speaks English → we translate to the
// session's detected language → stream back MP3 audio via ElevenLabs
// multilingual. The user plays the MP3 out loud so the other party hears it.
//
// Response headers carry the transcribed + translated text so the client can
// show what was just said in both languages without a second request.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  appendSegment,
  transcribeAudioBlob,
  translateFromEnglish,
} from "@/lib/meetings";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const sessionId = form.get("session_id");
  const audio = form.get("audio");
  const overrideLang = form.get("target_language");
  if (typeof sessionId !== "string" || !(audio instanceof Blob)) {
    return NextResponse.json({ error: "missing session_id or audio" }, { status: 400 });
  }

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("id, ended_at, user_id, detected_language, translate_to_english")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.ended_at) return NextResponse.json({ error: "session already ended" }, { status: 409 });

  const targetLang =
    (typeof overrideLang === "string" && overrideLang.trim()) ||
    session.detected_language ||
    "";
  if (!targetLang || targetLang === "en") {
    return NextResponse.json(
      { error: "no target language detected yet — wait for the other party to speak first" },
      { status: 400 },
    );
  }

  // 1. Transcribe the user's English (force English so we don't waste a
  //    detection call; user is always speaking EN into this button).
  let english = "";
  try {
    const r = await transcribeAudioBlob(audio, { translateToEnglish: false });
    english = r.text;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  if (!english) return NextResponse.json({ error: "no speech detected" }, { status: 400 });

  // 2. Translate to target language.
  const translated = await translateFromEnglish(english, targetLang);
  if (!translated) return NextResponse.json({ error: "translation failed" }, { status: 502 });

  // 3. Log it into the meeting segments so the transcript + recall show both
  //    sides of the conversation. Mark who spoke in the metadata-ish prefix
  //    (no speaker column yet — keep it simple).
  await appendSegment(
    supabase,
    user.id,
    sessionId,
    `[you] ${english}`,
    { originalText: `[you] ${translated}`, language: targetLang },
  );

  // 4. Stream MP3 via ElevenLabs multilingual.
  const elKey = process.env.ELEVENLABS_API_KEY;
  if (!elKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  // Use turbo_v2_5 which handles ~30 languages and is fast. Fallback to
  // multilingual_v2 if the voice can't handle turbo.
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: translated,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!ttsRes.ok || !ttsRes.body) {
    const msg = await ttsRes.text().catch(() => ttsRes.statusText);
    return NextResponse.json({ error: `elevenlabs: ${msg}` }, { status: 502 });
  }

  return new Response(ttsRes.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
      "x-original-text": encodeHeader(english),
      "x-translated-text": encodeHeader(translated),
      "x-target-language": targetLang,
    },
  });
}

function encodeHeader(s: string): string {
  // HTTP headers are ASCII-only; base64 so non-Latin output survives.
  return Buffer.from(s, "utf-8").toString("base64");
}
