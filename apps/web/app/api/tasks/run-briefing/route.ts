// Internal endpoint that kicks off a server-side morning briefing run for a
// queued task. Called fire-and-forget by the briefing cron or by ad-hoc
// scheduled tasks routed through run-scheduled.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runBriefingTask } from "@/lib/briefing-run";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { task_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const taskId = body.task_id;
  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ ok: false, error: "missing task_id" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  void runBriefingTask(admin, taskId).catch((e) => {
    console.error("[run-briefing] uncaught:", e);
  });

  return NextResponse.json({ ok: true, task_id: taskId });
}
