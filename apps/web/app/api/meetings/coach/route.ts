import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { coachTurn } from "@/lib/meetings";
import { isFeatureEnabledForUser } from "@/lib/user-features";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { session_id?: string } | null;
  if (!body?.session_id) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  // Gate on the earpiece-coach feature: meetings can record without it, but
  // whispers are opt-in.
  const on = await isFeatureEnabledForUser(supabase, user.id, "agent.earpiece_coach");
  if (!on) return NextResponse.json({ hint: null });

  try {
    const hint = await coachTurn(supabase, user.id, body.session_id);
    return NextResponse.json({ hint });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
