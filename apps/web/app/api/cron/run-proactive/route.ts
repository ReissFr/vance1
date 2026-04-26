// Proactive cron worker. Runs every ~30 minutes. For each user with
// proactive_enabled, asks the judge whether to interrupt them right now.
// Idempotency / rate-limit / quiet-hours all live in proactive-run.ts.

import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runProactiveTickForUser, sendDemoProactivePing } from "@/lib/proactive-run";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 200;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handle(req);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handle(req);
}

async function handle(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "true";
  const demoPing = req.nextUrl.searchParams.get("demo") === "true";
  const admin = supabaseAdmin();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }
  const anthropic = new Anthropic({ apiKey });

  const nowIso = new Date().toISOString();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, mobile_e164, google_access_token, display_name, proactive_snoozed_until, timezone, quiet_start_hour, quiet_end_hour")
    .eq("proactive_enabled", true)
    .not("mobile_e164", "is", null)
    .or(`proactive_snoozed_until.is.null,proactive_snoozed_until.lt.${nowIso}`)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[cron/run-proactive] profile query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ user_id: string; pinged: boolean; reason: string; topic?: string }> = [];
  for (const p of profiles ?? []) {
    try {
      if (demoPing) {
        await sendDemoProactivePing(admin, p.id as string, (p.mobile_e164 as string | null) ?? null);
        results.push({ user_id: p.id as string, pinged: true, reason: "demo ping", topic: "demo" });
        continue;
      }
      const res = await runProactiveTickForUser(
        admin,
        anthropic,
        {
          id: p.id as string,
          mobile_e164: (p.mobile_e164 as string | null) ?? null,
          google_access_token: (p.google_access_token as string | null) ?? null,
          display_name: (p.display_name as string | null) ?? null,
          timezone: (p.timezone as string | null) ?? null,
          quiet_start_hour: (p.quiet_start_hour as number | null) ?? null,
          quiet_end_hour: (p.quiet_end_hour as number | null) ?? null,
        },
        { force },
      );
      results.push({ user_id: p.id as string, ...res });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-proactive] user ${p.id} failed:`, msg);
      results.push({ user_id: p.id as string, pinged: false, reason: `error: ${msg}` });
    }
  }

  return NextResponse.json({
    ok: true,
    count: results.length,
    pinged: results.filter((r) => r.pinged).length,
    results,
  });
}
