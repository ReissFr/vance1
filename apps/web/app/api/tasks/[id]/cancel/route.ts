// Cancels a scheduled task before it fires. Only valid for queued tasks with
// a future `scheduled_at` — an already-running task (or an immediately-queued
// one about to be picked up by the worker) shouldn't be cancellable here to
// avoid racing the runner. Counterpart to /approve and /reject.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();

  const { data: task } = await admin
    .from("tasks")
    .select("id, status, scheduled_at")
    .eq("id", taskId)
    .eq("user_id", auth.user.id)
    .single();
  if (!task) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (task.status !== "queued") {
    return NextResponse.json(
      { ok: false, error: `cannot cancel task with status '${task.status}'` },
      { status: 400 },
    );
  }
  if (!task.scheduled_at || new Date(task.scheduled_at as string).getTime() <= Date.now()) {
    return NextResponse.json(
      { ok: false, error: "task is due now or unscheduled — refusing to cancel to avoid runner race" },
      { status: 400 },
    );
  }

  const { error } = await admin
    .from("tasks")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", auth.user.id)
    .eq("status", "queued");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
