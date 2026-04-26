// Brand voice singleton CRUD. GET returns the user's voice config (or empty
// defaults if none saved). PUT upserts on user_id so saving overwrites.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function sanitizeArr(input: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

function trimNullable(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("brand_voice")
    .select("tone_keywords, avoid_words, greeting, signature, voice_notes, sample_email, sample_message, sample_post, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    voice:
      data ?? {
        tone_keywords: [],
        avoid_words: [],
        greeting: null,
        signature: null,
        voice_notes: null,
        sample_email: null,
        sample_message: null,
        sample_post: null,
        updated_at: null,
      },
  });
}

export async function PUT(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payload = {
    user_id: user.id,
    tone_keywords: sanitizeArr(body.tone_keywords, 12, 40),
    avoid_words: sanitizeArr(body.avoid_words, 30, 40),
    greeting: trimNullable(body.greeting, 200),
    signature: trimNullable(body.signature, 200),
    voice_notes: trimNullable(body.voice_notes, 4000),
    sample_email: trimNullable(body.sample_email, 8000),
    sample_message: trimNullable(body.sample_message, 4000),
    sample_post: trimNullable(body.sample_post, 4000),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("brand_voice")
    .upsert(payload, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
