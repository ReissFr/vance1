import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { appendSegment, transcribeAudioBlob } from "@/lib/meetings";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const sessionId = form.get("session_id");
  const audio = form.get("audio");
  if (typeof sessionId !== "string" || !(audio instanceof Blob)) {
    return NextResponse.json({ error: "missing session_id or audio" }, { status: 400 });
  }

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("id, ended_at, user_id, translate_to_english, detected_language")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.ended_at) return NextResponse.json({ error: "session already ended" }, { status: 409 });

  let result;
  try {
    result = await transcribeAudioBlob(audio, {
      translateToEnglish: session.translate_to_english ?? false,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  if (result.text) {
    await appendSegment(supabase, user.id, sessionId, result.text, {
      originalText: result.originalText,
      language: result.language,
    });
  }

  // First non-English detection for this session → stash it on the session so
  // the UI can show a flag badge without reading every segment.
  if (
    session.translate_to_english &&
    result.language &&
    result.language !== "en" &&
    !session.detected_language
  ) {
    await supabase
      .from("meeting_sessions")
      .update({ detected_language: result.language })
      .eq("id", sessionId);
  }

  return NextResponse.json({
    text: result.text,
    original_text: result.originalText,
    language: result.language,
  });
}
