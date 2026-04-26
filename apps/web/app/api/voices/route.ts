import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface VoiceSummary {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category: string | null;
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const elKey = process.env.ELEVENLABS_API_KEY;
  if (!elKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  const res = await fetch("https://api.elevenlabs.io/v2/voices?page_size=50", {
    headers: { "xi-api-key": elKey },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    return NextResponse.json({ error: `elevenlabs: ${msg}` }, { status: 502 });
  }
  const data = (await res.json()) as {
    voices: { voice_id: string; name: string; preview_url?: string; category?: string }[];
  };
  const voices: VoiceSummary[] = data.voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url ?? null,
    category: v.category ?? null,
  }));

  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("voice_id")
    .eq("id", user.id)
    .single();

  return NextResponse.json({ voices, selected: profile?.voice_id ?? null });
}

interface SelectBody {
  voice_id: string;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as SelectBody;
  if (!body.voice_id) return NextResponse.json({ error: "missing voice_id" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({ voice_id: body.voice_id })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
