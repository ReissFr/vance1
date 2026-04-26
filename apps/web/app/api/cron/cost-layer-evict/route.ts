// Sweeps expired and stale rows out of the cost-layer caches. Safe to run
// often — every delete is idempotent and bounded. Recommended cadence:
// once per hour.
//
// Rows cleaned:
//   - result_cache: rows past their expires_at (semantic reasoning cache)
//   - embedding_cache: rows not hit in the last 30 days (embedding memoiser)
//   - skill_failures: expired negative-cache entries
//   - skill_runs: runs older than 90 days (kept only for promotion math,
//                 which already happened)
//   - batch_queue: completed/failed rows older than 7 days
//
// Auth: CRON_SECRET header convention (same as other crons).

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { evictExpired } from "@jarvis/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMBEDDING_STALE_DAYS = 30;
const SKILL_RUN_KEEP_DAYS = 90;
const BATCH_KEEP_DAYS = 7;

export async function POST(req: NextRequest) {
  return guarded(req, handle);
}

export async function GET(req: NextRequest) {
  return guarded(req, handle);
}

async function guarded(
  req: NextRequest,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  return fn();
}

async function handle(): Promise<NextResponse> {
  const admin = supabaseAdmin();
  const results: Record<string, { deleted?: number; error?: string }> = {};

  // result_cache — delegates to the helper shipped with the agent package.
  try {
    await evictExpired(admin);
    results.result_cache = { deleted: -1 }; // helper doesn't return count
  } catch (e) {
    results.result_cache = { error: e instanceof Error ? e.message : String(e) };
  }

  // embedding_cache — stale entries.
  try {
    const cutoff = new Date(
      Date.now() - EMBEDDING_STALE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count, error } = await admin
      .from("embedding_cache")
      .delete({ count: "exact" })
      .or(`last_hit_at.lt.${cutoff},and(last_hit_at.is.null,created_at.lt.${cutoff})`);
    if (error) throw error;
    results.embedding_cache = { deleted: count ?? 0 };
  } catch (e) {
    results.embedding_cache = { error: e instanceof Error ? e.message : String(e) };
  }

  // skill_failures — past expiry.
  try {
    const { count, error } = await admin
      .from("skill_failures")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());
    if (error) throw error;
    results.skill_failures = { deleted: count ?? 0 };
  } catch (e) {
    results.skill_failures = { error: e instanceof Error ? e.message : String(e) };
  }

  // skill_runs — old rows (promotion math already done).
  try {
    const cutoff = new Date(
      Date.now() - SKILL_RUN_KEEP_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count, error } = await admin
      .from("skill_runs")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);
    if (error) throw error;
    results.skill_runs = { deleted: count ?? 0 };
  } catch (e) {
    results.skill_runs = { error: e instanceof Error ? e.message : String(e) };
  }

  // batch_queue — old completed/failed rows.
  try {
    const cutoff = new Date(
      Date.now() - BATCH_KEEP_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count, error } = await admin
      .from("batch_queue")
      .delete({ count: "exact" })
      .in("status", ["completed", "failed"])
      .lt("completed_at", cutoff);
    if (error) throw error;
    results.batch_queue = { deleted: count ?? 0 };
  } catch (e) {
    results.batch_queue = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ ok: true, results });
}
