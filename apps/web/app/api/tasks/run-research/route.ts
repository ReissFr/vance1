// Internal endpoint that kicks off a server-side research run for a queued
// task. Called fire-and-forget by the research_agent tool; the brain doesn't
// wait for this to finish.
//
// Auth: this endpoint has no user auth. It loads the task by id and uses the
// service role to write back. That's safe because:
//   1. The task_id is a UUID (unguessable).
//   2. The runner only processes tasks in status='queued' and only updates
//      rows owned by the user_id already on the row.
//   3. The tool always inserts via ctx.supabase which is already scoped to the
//      authenticated user before this endpoint ever sees the id.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runResearchTask } from "@/lib/research-run";

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

  // Fire and forget — respond immediately so the tool's caller doesn't block.
  void runResearchTask(admin, taskId).catch((e) => {
    console.error("[run-research] uncaught:", e);
  });

  return NextResponse.json({ ok: true, task_id: taskId });
}
