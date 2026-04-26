import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "missing audio" }, { status: 400 });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json({ error: "GROQ_API_KEY not set" }, { status: 500 });

  const upstream = new FormData();
  upstream.append("file", audio, "audio.webm");
  upstream.append("model", "whisper-large-v3-turbo");
  upstream.append("response_format", "json");
  upstream.append("language", "en");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${groqKey}` },
    body: upstream,
  });

  if (!res.ok) {
    const msg = await res.text();
    return NextResponse.json({ error: `groq: ${msg}` }, { status: 502 });
  }

  const data = (await res.json()) as { text?: string };
  return NextResponse.json({ text: data.text ?? "" });
}
