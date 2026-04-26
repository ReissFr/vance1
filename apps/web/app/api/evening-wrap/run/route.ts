// User-facing trigger: queue an evening-wrap task and kick off the runner
// fire-and-forget. Called by the settings "Run now" button next to the
// evening-wrap toggle.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { notify?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      kind: "evening_wrap",
      prompt: "Run evening wrap-up",
      args: { notify: body.notify ?? false, title: "Evening wrap" },
      device_target: "server",
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !task) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  const baseUrl =
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030";
  void fetch(`${baseUrl}/api/tasks/run-evening-wrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_id: task.id }),
  }).catch((e) => console.warn("[api/evening-wrap/run] dispatch failed:", e));

  return NextResponse.json({ ok: true, task_id: task.id });
}
