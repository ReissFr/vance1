// Snoozes a scheduled task by shifting its `scheduled_at` forward. Only valid
// for queued tasks whose current schedule is still in the future — we don't
// want to fight the runner for tasks that are due now. Body: { minutes: number }
// (positive integer, capped at 7 days to avoid silly offsets).

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_SNOOZE_MINUTES = 7 * 24 * 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { minutes?: unknown } = {};
  try {
    body = (await req.json()) as { minutes?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const minutes = Number(body.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_SNOOZE_MINUTES) {
    return NextResponse.json(
      { ok: false, error: `minutes must be between 1 and ${MAX_SNOOZE_MINUTES}` },
      { status: 400 },
    );
  }

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
      { ok: false, error: `cannot snooze task with status '${task.status}'` },
      { status: 400 },
    );
  }
  const currentTs = task.scheduled_at ? new Date(task.scheduled_at as string).getTime() : 0;
  if (!currentTs || currentTs <= Date.now()) {
    return NextResponse.json(
      { ok: false, error: "task is due now or unscheduled — refusing to snooze to avoid runner race" },
      { status: 400 },
    );
  }

  const nextTs = new Date(currentTs + minutes * 60_000).toISOString();

  const { error } = await admin
    .from("tasks")
    .update({ scheduled_at: nextTs })
    .eq("id", taskId)
    .eq("user_id", auth.user.id)
    .eq("status", "queued");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, scheduled_at: nextTs });
}
