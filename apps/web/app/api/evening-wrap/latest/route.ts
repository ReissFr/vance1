// Returns the most recent evening-wrap task so the /evening-wrap page (and
// any other viewer) can render the real synthesised text instead of
// reading it in WhatsApp.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("evening_wrap_enabled, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, result, error, created_at, completed_at, args")
    .eq("user_id", user.id)
    .eq("kind", "evening_wrap")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const text = task?.result != null
    ? (typeof task.result === "string" ? task.result : String(task.result))
    : null;

  return NextResponse.json({
    ok: true,
    enabled: Boolean(profile?.evening_wrap_enabled),
    display_name: profile?.display_name ?? null,
    task: task
      ? {
          id: task.id,
          status: task.status,
          error: task.error,
          created_at: task.created_at,
          completed_at: task.completed_at,
          title: (task.args as { title?: string } | null)?.title ?? "Evening wrap",
        }
      : null,
    text,
  });
}
