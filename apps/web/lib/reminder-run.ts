// Server-side runner for reminder tasks (kind='reminder'). No LLM involved —
// just sends the stored message via WhatsApp and marks the task done. Invoked
// by the /api/cron/run-scheduled endpoint when a reminder's scheduled_at is
// due.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "./notify";

type ReminderArgs = {
  title?: string;
  message?: string;
};

export async function runReminderTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[reminder-run] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[reminder-run] task not queued, skipping:", taskId, task.status);
    return;
  }

  const args: ReminderArgs = task.args ?? {};
  const message = args.message ?? task.prompt ?? "(empty reminder)";

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", taskId);

  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", task.user_id)
    .single();

  if (!profile?.mobile_e164) {
    await admin
      .from("tasks")
      .update({
        status: "failed",
        error: "No mobile number on profile — cannot deliver reminder",
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    return;
  }

  const body = `⏰ ${message}`;

  const { data: notif, error: insErr } = await admin
    .from("notifications")
    .insert({
      user_id: task.user_id,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
      task_id: taskId,
    })
    .select("id")
    .single();

  if (insErr || !notif) {
    await admin
      .from("tasks")
      .update({
        status: "failed",
        error: `Failed to queue notification: ${insErr?.message ?? "unknown"}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    return;
  }

  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[reminder-run] dispatch failed:", e);
  }

  await admin
    .from("tasks")
    .update({
      status: "done",
      result: body,
      completed_at: new Date().toISOString(),
    })
    .eq("id", taskId);
}
