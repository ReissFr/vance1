// Internal fire-and-forget endpoint that kicks off a server-side concierge run
// for a queued task. Called by the concierge_task brain tool; the brain
// doesn't wait for this to finish. Same auth model as run-research (task_id
// is an unguessable UUID, runner only touches rows where status='queued').

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runConciergeTask } from "@/lib/concierge-run";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  void runConciergeTask(admin, taskId).catch((e) => {
    console.error("[run-concierge] uncaught:", e);
  });

  return NextResponse.json({ ok: true, task_id: taskId });
}
