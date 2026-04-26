// Bulk-retry failed tasks. Accepts { ids } (cap 50), validates each task is
// status=failed + kind is in the retryable whitelist, resets each to queued,
// fires the runner in parallel. Mirrors the single /api/tasks/[id]/retry
// semantics so bulk can never reach kinds single-retry blocks.

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

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = rawIds
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, 50);
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "no ids provided" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: tasks, error: fetchErr } = await admin
    .from("tasks")
    .select("id, kind, status")
    .in("id", ids)
    .eq("user_id", auth.user.id);
  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  const retryable: Array<{ id: string; runnerPath: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const id of ids) {
    const task = (tasks ?? []).find((t) => t.id === id);
    if (!task) {
      skipped.push({ id, reason: "not found" });
      continue;
    }
    if (task.status !== "failed") {
      skipped.push({ id, reason: `status=${task.status}` });
      continue;
    }
    const runnerPath = runnerPathForKind(task.kind as string);
    if (!runnerPath) {
      skipped.push({ id, reason: `kind '${task.kind}' not whitelisted` });
      continue;
    }
    retryable.push({ id, runnerPath });
  }

  if (retryable.length === 0) {
    return NextResponse.json({ ok: true, retried: 0, skipped });
  }

  const retryIds = retryable.map((r) => r.id);
  const { error: resetErr } = await admin
    .from("tasks")
    .update({
      status: "queued",
      error: null,
      completed_at: null,
      started_at: null,
    })
    .in("id", retryIds)
    .eq("user_id", auth.user.id)
    .eq("status", "failed");
  if (resetErr) {
    return NextResponse.json({ ok: false, error: resetErr.message }, { status: 500 });
  }

  const baseUrl = resolveBaseUrl();
  await Promise.all(
    retryable.map(({ id, runnerPath }) =>
      fetch(`${baseUrl}${runnerPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: id }),
      }).catch((e) => {
        console.warn(`[tasks/bulk-retry] dispatch failed for ${id}:`, e);
      }),
    ),
  );

  return NextResponse.json({ ok: true, retried: retryable.length, skipped });
}
