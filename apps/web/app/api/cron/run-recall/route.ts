// Incremental Total Recall sync — runs on a schedule (e.g. every 30 min).
// For each user who has the "scheduled.recall_sync" feature enabled, pulls
// new Gmail messages, calendar events, and chat turns since the last cursor
// and embeds them into recall_events.
//
// Auth: same CRON_SECRET pattern as run-briefings.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { syncAll } from "@/lib/recall";
import { isFeatureEnabledForUser } from "@/lib/user-features";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_LIMIT = 100;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return handle();
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return handle();
}

async function handle() {
  const admin = supabaseAdmin();

  // Candidates: anyone with a Google token (required for email/calendar).
  // Chat sync works without it, but most of the value needs Google.
  const { data: users, error } = await admin
    .from("profiles")
    .select("id")
    .not("google_access_token", "is", null)
    .limit(BATCH_LIMIT);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const summary: { user_id: string; results?: unknown; skipped?: string }[] = [];
  for (const p of users ?? []) {
    try {
      const enabled = await isFeatureEnabledForUser(admin, p.id, "scheduled.recall_sync");
      if (!enabled) {
        summary.push({ user_id: p.id, skipped: "feature off" });
        continue;
      }
      const results = await syncAll(admin, p.id);
      summary.push({ user_id: p.id, results });
    } catch (e) {
      summary.push({ user_id: p.id, skipped: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, users: summary.length, summary });
}
