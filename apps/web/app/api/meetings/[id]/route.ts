import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { listRecentSegments } from "@/lib/meetings";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  const segments = await listRecentSegments(supabase, id, 1000);
  return NextResponse.json({ session, segments });
}
