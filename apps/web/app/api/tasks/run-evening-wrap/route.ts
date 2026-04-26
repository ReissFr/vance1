// Internal endpoint that kicks off a server-side evening wrap-up run for a
// queued task. Called fire-and-forget by /api/cron/run-evening-wraps.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runEveningWrapTask } from "@/lib/evening-wrap-run";

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
  void runEveningWrapTask(admin, taskId).catch((e) => {
    console.error("[run-evening-wrap] uncaught:", e);
  });
  return NextResponse.json({ ok: true, task_id: taskId });
}
