// Retry a failed task by resetting it to queued and re-firing the appropriate
// runner endpoint. Whitelisted to kinds that are idempotent or cheap to repeat.
// Explicitly excludes side-effect-heavy kinds (crypto_send, concierge, code_agent)
// where a double-run could cost money or duplicate user-facing state.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

function runnerPathForKind(kind: string): string | null {
  switch (kind) {
    case "briefing":
      return "/api/tasks/run-briefing";
    case "evening_wrap":
      return "/api/tasks/run-evening-wrap";
    case "weekly_review":
      return "/api/tasks/run-weekly-review";
    case "receipts_scan":
      return "/api/tasks/run-receipts-scan";
    case "subscription_scan":
    case "subscriptions_scan":
      return "/api/tasks/run-subscription-scan";
    case "commitments_scan":
      return "/api/tasks/run-commitments-scan";
    case "inbox":
      return "/api/tasks/run-inbox";
    case "writer":
      return "/api/tasks/run-writer";
    case "outreach":
      return "/api/tasks/run-outreach";
    case "research":
    case "researcher":
      return "/api/tasks/run-research";
    case "errand":
      return "/api/tasks/run-errand";
    default:
      return null;
  }
}

function resolveBaseUrl(): string {
  return (
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030"
  );
}

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
    .select("id, kind, status")
    .eq("id", taskId)
    .eq("user_id", auth.user.id)
    .single();
  if (!task) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (task.status !== "failed") {
    return NextResponse.json(
      { ok: false, error: `cannot retry task with status '${task.status}' — only failed tasks are retryable` },
      { status: 400 },
    );
  }

  const runnerPath = runnerPathForKind(task.kind as string);
  if (!runnerPath) {
    return NextResponse.json(
      { ok: false, error: `kind '${task.kind}' is not whitelisted for retry (risk of duplicate side effects)` },
      { status: 400 },
    );
  }

  const { error: resetErr } = await admin
    .from("tasks")
    .update({
      status: "queued",
      error: null,
      completed_at: null,
      started_at: null,
    })
    .eq("id", taskId)
    .eq("user_id", auth.user.id)
    .eq("status", "failed");
  if (resetErr) return NextResponse.json({ ok: false, error: resetErr.message }, { status: 500 });

  const baseUrl = resolveBaseUrl();
  void fetch(`${baseUrl}${runnerPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  }).catch((e) => {
    console.warn(`[tasks/retry] dispatch fetch failed for ${taskId}:`, e);
  });

  return NextResponse.json({ ok: true });
}
