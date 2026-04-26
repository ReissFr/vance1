// Writes a first-run memory captured during onboarding. The user's "tell me
// about yourself" blurb gets saved as one or more long-term memories so
// JARVIS has real context from turn one. We use the same Voyage embed path
// the brain uses so the memory is recallable via /recall and tools.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { makeVoyageEmbed, saveMemory } from "@jarvis/agent";

export const runtime = "nodejs";

interface Body {
  content: string;
  kind?: "fact" | "preference" | "person" | "event" | "task";
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { content, kind = "fact" } = (await req.json()) as Body;
  if (!content?.trim()) {
    return NextResponse.json({ error: "empty content" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const embed = makeVoyageEmbed(process.env.VOYAGE_API_KEY!);
  const m = await saveMemory(admin, embed, {
    userId: user.id,
    kind,
    content: content.trim(),
  });
  return NextResponse.json({ ok: true, id: m.id });
}
