// Polls the ventures table for autonomous heartbeats that are now due and
// fires runVentureHeartbeat for each. Runs on a Netlify/Vercel cron schedule
// (suggested: every minute).
//
// Eligibility for a cron-fired heartbeat:
//   1. ventures.autonomy IN ('autonomous', 'full_autopilot')  — manual and
//      supervised never auto-fire; the user has to press the button.
//   2. ventures.status NOT IN ('paused', 'killed')
//   3. ventures.paused_at IS NULL
//   4. ventures.next_heartbeat_at <= now()
//   5. The owning user has profiles.ventures_panic_stop_at IS NULL
//      (the heartbeat itself ALSO checks panic stop as a defence in depth,
//       but skipping here saves the Haiku call entirely.)
//
// Auth: shared CRON_SECRET header. Same pattern as run-scheduled.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runVentureHeartbeat } from "@/lib/venture-heartbeat";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cap per tick — each heartbeat is a Haiku call + N start_errand inserts.
// Anything beyond this rolls to the next tick.
const BATCH_SIZE = 6;

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
  const now = new Date().toISOString();

  const { data: due, error } = await admin
    .from("ventures")
    .select("id, user_id, name, autonomy, status, paused_at, next_heartbeat_at")
    .in("autonomy", ["autonomous", "full_autopilot"])
    .not("status", "in", "(paused,killed)")
    .is("paused_at", null)
    .not("next_heartbeat_at", "is", null)
    .lte("next_heartbeat_at", now)
    .order("next_heartbeat_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[cron/run-ventures] query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, now, count: 0, results: [] });
  }

  // Filter out ventures whose owner has the global panic stop set. We could
  // do this in the query with a join, but RLS-friendly + simple is to fetch
  // the small set of distinct user_ids and check.
  const userIds = Array.from(new Set(due.map((v) => v.user_id)));
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, ventures_panic_stop_at")
    .in("id", userIds);
  const panicByUser = new Map<string, boolean>();
  for (const p of profiles ?? []) {
    panicByUser.set(p.id, Boolean((p as { ventures_panic_stop_at: string | null }).ventures_panic_stop_at));
  }

  const eligible = due.filter((v) => !panicByUser.get(v.user_id));
  const skipped = due.length - eligible.length;

  // Fire heartbeats in parallel (each writes to its own venture row).
  const results = await Promise.all(
    eligible.map(async (v) => {
      try {
        const r = await runVentureHeartbeat(admin, v.user_id, v.id);
        return {
          venture_id: v.id,
          name: v.name,
          ok: r.ok,
          decisions_proposed: r.decisions_proposed,
          dispatched: r.auto_dispatched + r.notify_dispatched + r.approve_dispatched,
          queued: r.queued,
          error: r.error,
        };
      } catch (e) {
        return {
          venture_id: v.id,
          name: v.name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  return NextResponse.json({
    ok: true,
    now,
    considered: due.length,
    skipped_due_to_panic_stop: skipped,
    fired: results.length,
    results,
  });
}
