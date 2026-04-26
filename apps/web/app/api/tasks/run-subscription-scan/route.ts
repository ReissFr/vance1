// Internal endpoint that kicks off a server-side subscription scan for a
// queued task. Called fire-and-forget by the subscriptions_scan brain tool.
// Safe to invoke repeatedly — the scanner upserts by dedup_key.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runSubscriptionScanTask } from "@/lib/subscription-scan";

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

  void runSubscriptionScanTask(admin, taskId).catch((e) => {
    console.error("[run-subscription-scan] uncaught:", e);
  });

  return NextResponse.json({ ok: true, task_id: taskId });
}
