import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getActiveSession, startSession } from "@/lib/meetings";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Idempotent: if there's already an active session, return it.
  const existing = await getActiveSession(supabase, user.id);
  if (existing) return NextResponse.json({ session: existing });

  const body = (await req.json().catch(() => null)) as
    | { translate_to_english?: boolean }
    | null;

  const session = await startSession(supabase, user.id, {
    translateToEnglish: body?.translate_to_english ?? false,
  });
  return NextResponse.json({ session });
}
