import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getActiveSession, listSessions } from "@/lib/meetings";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [sessions, active] = await Promise.all([
    listSessions(supabase, user.id, 50),
    getActiveSession(supabase, user.id),
  ]);
  return NextResponse.json({ sessions, active });
}
