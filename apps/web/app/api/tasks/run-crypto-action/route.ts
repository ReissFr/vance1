// Internal endpoint that executes a queued crypto action
// (kind='crypto_send' or kind='crypto_whitelist_add'). Fired from the brain's
// crypto_action_respond tool after the user approves over WhatsApp.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runCryptoActionTask } from "@/lib/crypto-send";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  void runCryptoActionTask(admin, taskId).catch((e) => {
    console.error("[run-crypto-action] uncaught:", e);
  });

  return NextResponse.json({ ok: true, task_id: taskId });
}
