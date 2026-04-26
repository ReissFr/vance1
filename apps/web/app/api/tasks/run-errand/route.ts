// Internal endpoint that ticks a queued errand. Fire-and-forget; long runs
// are broken into 30-min ticks so no single request is long-running.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runErrandTask } from "@/lib/errand-run";

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

  void runErrandTask(admin, taskId).catch((e) => {
    console.error("[run-errand] uncaught:", e);
  });

  return NextResponse.json({ ok: true, task_id: taskId });
}
