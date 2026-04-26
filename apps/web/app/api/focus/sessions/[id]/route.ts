// Patch a focus session when the user Stops or lets it run to completion.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const actual =
    typeof body.actual_seconds === "number" && body.actual_seconds >= 0
      ? Math.round(body.actual_seconds)
      : null;
  const completed = body.completed_fully === true;

  const { error } = await supabase
    .from("focus_sessions")
    .update({
      ended_at: new Date().toISOString(),
      actual_seconds: actual,
      completed_fully: completed,
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
