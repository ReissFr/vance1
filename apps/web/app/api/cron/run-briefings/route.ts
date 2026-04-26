// Daily fan-out: finds every user with briefing_enabled=true and a mobile
// number, creates a fresh tasks row (kind='briefing') for each, and fires the
// runner fire-and-forget. Intended to be called once per day at 07:00 London
// time by the cron scheduler.
//
// Auth: same CRON_SECRET header convention as /api/cron/run-scheduled.
//
// Idempotency: skips users who already have a briefing task created today,
// so a duplicate cron fire doesn't double-send.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 200;

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

  const { data: users, error } = await admin
    .from("profiles")
    .select("id, mobile_e164")
    .eq("briefing_enabled", true)
    .not("mobile_e164", "is", null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[cron/run-briefings] profile query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayIso = startOfDay.toISOString();

  const results: Array<{ user_id: string; task_id?: string; skipped?: string }> = [];
  const baseUrl = resolveBaseUrl();

  for (const profile of users ?? []) {
    try {
      const { data: existing } = await admin
        .from("tasks")
        .select("id")
        .eq("user_id", profile.id)
        .eq("kind", "briefing")
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
          kind: "briefing",
          status: "queued",
          prompt: "Morning briefing",
          args: { title: "Morning briefing", notify: true },
          device_target: "server",
        })
        .select("id")
        .single();
      if (insertErr || !task) {
        results.push({ user_id: profile.id, skipped: `insert failed: ${insertErr?.message ?? "no row"}` });
        continue;
      }

      void fetch(`${baseUrl}/api/tasks/run-briefing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: task.id }),
      }).catch((e) => {
        console.warn(`[cron/run-briefings] dispatch fetch failed for ${task.id}:`, e);
      });
      results.push({ user_id: profile.id, task_id: task.id as string });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-briefings] error for ${profile.id}:`, msg);
      results.push({ user_id: profile.id, skipped: msg });
    }
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}

function resolveBaseUrl(): string {
  return (
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030"
  );
}
