// Polls the tasks table for scheduled work that's now due and dispatches it.
// Runs on a Netlify/Vercel cron schedule (suggested: every minute). Due =
// status='queued' AND scheduled_at IS NOT NULL AND scheduled_at <= now().
//
// Auth: protected by a shared CRON_SECRET header. Without it, anyone with the
// URL could force-fire reminders. The cron runner is configured to send this
// header; manual invocation needs it too.
//
// Dispatch:
// - kind='reminder'        → runReminderTask (sends WhatsApp, marks done)
// - kind='research'        → fire /api/tasks/run-research
// - kind='writer'          → fire /api/tasks/run-writer
// - kind='outreach'        → fire /api/tasks/run-outreach
// - kind='inbox'           → fire /api/tasks/run-inbox
// Anything else: mark failed with a descriptive error.

import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runReminderTask } from "@/lib/reminder-run";
import { dispatchNotification } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cap per tick so a big backlog can't blow up the request budget. Any tasks
// beyond this are picked up on the next tick.
const BATCH_SIZE = 20;

// After this many minutes sitting in needs_approval without the user touching
// it, escalate from WhatsApp (already sent at pause-time) to a voice call.
// Kept short because concierge browser sessions time out at 5 min.
const NAG_AFTER_MIN = 3;
// Never ring more than once per task per X min, even if approval keeps lingering.
const NAG_COOLDOWN_MIN = 10;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  return handle();
}

// Some cron services (Vercel) only GET. Accept both.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  return handle();
}

async function handle() {
  const admin = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: due, error } = await admin
    .from("tasks")
    .select("id, kind, user_id, scheduled_at")
    .eq("status", "queued")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[cron/run-scheduled] query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ task_id: string; kind: string; dispatched: boolean; note?: string }> = [];

  for (const task of due ?? []) {
    try {
      if (task.kind === "reminder") {
        // Run inline — reminder is cheap (one Twilio call).
        await runReminderTask(admin, task.id);
        results.push({ task_id: task.id, kind: task.kind, dispatched: true });
        continue;
      }

      const runnerPath = runnerPathForKind(task.kind);
      if (!runnerPath) {
        await admin
          .from("tasks")
          .update({
            status: "failed",
            error: `Scheduled task has no registered runner for kind='${task.kind}'`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id);
        results.push({ task_id: task.id, kind: task.kind, dispatched: false, note: "no runner" });
        continue;
      }

      // Fire-and-forget the appropriate runner endpoint.
      const baseUrl = resolveBaseUrl();
      void fetch(`${baseUrl}${runnerPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: task.id }),
      }).catch((e) => {
        console.warn(`[cron/run-scheduled] dispatch fetch failed for ${task.id}:`, e);
      });
      results.push({ task_id: task.id, kind: task.kind, dispatched: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-scheduled] error for ${task.id}:`, msg);
      results.push({ task_id: task.id, kind: task.kind, dispatched: false, note: msg });
    }
  }

  const nagResults = await nagStaleApprovals(admin);

  return NextResponse.json({
    ok: true,
    now,
    count: results.length,
    results,
    nags: nagResults,
  });
}

// Second pass: find tasks that have been waiting for human approval for >
// NAG_AFTER_MIN minutes with no voice call yet (or last one > NAG_COOLDOWN_MIN
// ago), and place a call. This is the "if you don't reply to WhatsApp, I'll
// phone you" escalation path.
async function nagStaleApprovals(
  admin: SupabaseClient,
): Promise<Array<{ task_id: string; ok: boolean; note?: string }>> {
  const results: Array<{ task_id: string; ok: boolean; note?: string }> = [];
  const cutoff = new Date(Date.now() - NAG_AFTER_MIN * 60_000).toISOString();

  const { data: stale, error } = await admin
    .from("tasks")
    .select("id, kind, user_id, args, result, needs_approval_at")
    .eq("status", "needs_approval")
    .not("needs_approval_at", "is", null)
    .lte("needs_approval_at", cutoff)
    .limit(20);

  if (error) {
    console.warn("[cron/nag] query failed:", error.message);
    return results;
  }

  for (const task of stale ?? []) {
    try {
      // Skip if we've already rung about this task recently.
      const cooldownSince = new Date(Date.now() - NAG_COOLDOWN_MIN * 60_000).toISOString();
      const { data: recent } = await admin
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("channel", "call")
        .gte("created_at", cooldownSince)
        .limit(1);
      if (recent && recent.length > 0) {
        results.push({ task_id: task.id, ok: false, note: "cooldown" });
        continue;
      }

      const { data: profile } = await admin
        .from("profiles")
        .select("mobile_e164")
        .eq("id", task.user_id)
        .single();
      if (!profile?.mobile_e164) {
        results.push({ task_id: task.id, ok: false, note: "no mobile" });
        continue;
      }

      const body = buildVoiceBody(task);

      const { data: notif, error: nErr } = await admin
        .from("notifications")
        .insert({
          user_id: task.user_id,
          task_id: task.id,
          channel: "call",
          to_e164: profile.mobile_e164,
          body,
          status: "queued",
        })
        .select("id")
        .single();
      if (nErr || !notif) {
        results.push({ task_id: task.id, ok: false, note: nErr?.message ?? "insert failed" });
        continue;
      }

      await dispatchNotification(admin, notif.id);
      results.push({ task_id: task.id, ok: true });
    } catch (e) {
      results.push({
        task_id: task.id,
        ok: false,
        note: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}

function buildVoiceBody(task: {
  kind: string;
  args?: Record<string, unknown> | null;
  result?: string | null;
}): string {
  // Kept short and unambiguous — the TwiML wrapper adds pauses and the "Press 1
  // to approve" line separately, so we don't repeat it here.
  if (task.kind === "concierge") {
    return `Hi, this is Jarvis. Your concierge booking is waiting for your approval.`;
  }
  const title = (task.args?.title as string | undefined) ?? task.kind;
  return `Hi, this is Jarvis. Your ${task.kind} task, ${title}, is waiting for your approval.`;
}

function runnerPathForKind(kind: string): string | null {
  switch (kind) {
    case "research":
      return "/api/tasks/run-research";
    case "writer":
      return "/api/tasks/run-writer";
    case "outreach":
      return "/api/tasks/run-outreach";
    case "inbox":
      return "/api/tasks/run-inbox";
    case "briefing":
      return "/api/tasks/run-briefing";
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
