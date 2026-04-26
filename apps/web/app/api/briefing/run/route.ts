// Creates a new briefing task for the current user and fires the runner
// fire-and-forget. Called by the /morning-briefing page when the user hits
// "Run briefing now".

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { title?: string; notify?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — falls through to defaults
  }
  const title = body.title?.trim() || "Morning briefing";
  const notify = body.notify ?? false;

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      kind: "briefing",
      prompt: "Run morning briefing",
      args: { title, notify },
      device_target: "server",
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !task) {
    return NextResponse.json({ ok: false, error: error?.message ?? "insert failed" }, { status: 500 });
  }

  const baseUrl =
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030";
  void fetch(`${baseUrl}/api/tasks/run-briefing`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_id: task.id }),
  }).catch((e) => console.warn("[api/briefing/run] dispatch failed:", e));

  return NextResponse.json({ ok: true, task_id: task.id });
}
