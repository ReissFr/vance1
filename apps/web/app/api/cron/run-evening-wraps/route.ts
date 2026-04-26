// Daily fan-out for evening wrap. Finds every user with evening_wrap_enabled=
// true and a mobile number, creates a fresh tasks row (kind='evening_wrap'),
// fires the runner fire-and-forget. Intended to be called once per day at
// 22:00 London time.
//
// Idempotent: skips users who already have an evening_wrap task created today.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 200;

async function handle() {
  const admin = supabaseAdmin();
  const { data: users, error } = await admin
    .from("profiles")
    .select("id, mobile_e164")
    .eq("evening_wrap_enabled", true)
    .not("mobile_e164", "is", null)
    .limit(BATCH_LIMIT);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayIso = startOfDay.toISOString();
  const baseUrl =
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030";

  const results: Array<{ user_id: string; task_id?: string; skipped?: string }> = [];
  for (const profile of users ?? []) {
    const { data: existing } = await admin
      .from("tasks")
      .select("id")
      .eq("user_id", profile.id)
      .eq("kind", "evening_wrap")
      .gte("created_at", startOfDayIso)
      .limit(1);
    if (existing && existing.length > 0) {
      results.push({ user_id: profile.id, skipped: "already sent today" });
      continue;
    }
    const { data: task, error: insertErr } = await admin
      .from("tasks")
      .insert({
        user_id: profile.id,
        kind: "evening_wrap",
        status: "queued",
        prompt: "Evening wrap-up",
        args: { title: "Evening wrap-up", notify: true },
        device_target: "server",
      })
      .select("id")
      .single();
    if (insertErr || !task) {
      results.push({ user_id: profile.id, skipped: `insert failed: ${insertErr?.message ?? "no row"}` });
      continue;
    }
    void fetch(`${baseUrl}/api/tasks/run-evening-wrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: task.id }),
    }).catch((e) => {
      console.warn(`[cron/run-evening-wraps] dispatch fetch failed for ${task.id}:`, e);
    });
    results.push({ user_id: profile.id, task_id: task.id as string });
  }
  return NextResponse.json({ ok: true, count: results.length, results });
}

function checkSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  if (req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const guard = checkSecret(req);
  if (guard) return guard;
  return handle();
}

export async function GET(req: NextRequest) {
  const guard = checkSecret(req);
  if (guard) return guard;
  return handle();
}
