// Internal endpoint that kicks off a server-side inbox triage run for a
// queued task. Called fire-and-forget by the inbox_agent tool AND by the
// scheduled-task cron when kind='inbox' is due.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runInboxTask } from "@/lib/inbox-run";

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

  void runInboxTask(admin, taskId).catch((e) => {
    console.error("[run-inbox] uncaught:", e);
  });

  return NextResponse.json({ ok: true, task_id: taskId });
}
