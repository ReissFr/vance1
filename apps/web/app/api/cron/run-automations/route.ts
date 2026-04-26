// Cron worker for automation rules. Runs every minute.
//
// Two passes:
//   1. Cron-triggered automations: find rules where next_fire_at <= now(), call
//      dispatchTrigger('cron'), then advance next_fire_at via the RRULE.
//   2. Bootstrap: any cron rule with next_fire_at IS NULL gets its next_fire_at
//      computed from its RRULE. Lets newly-created rules pick up.
//
// Auth: same CRON_SECRET pattern as run-scheduled.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchTrigger } from "@/lib/automation-engine";
import { nextFireAfter } from "@/lib/automation-rrule";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 50;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handle();
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handle();
}

async function handle() {
  const admin = supabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();

  // Pass 1: bootstrap any cron rule missing next_fire_at.
  const { data: pending } = await admin
    .from("automations")
    .select("id, trigger_spec")
    .eq("trigger_kind", "cron")
    .eq("enabled", true)
    .is("next_fire_at", null)
    .limit(BATCH_SIZE);

  for (const rule of pending ?? []) {
    const rrule = (rule.trigger_spec as { rrule?: string; tz?: string })?.rrule;
    const tz = (rule.trigger_spec as { rrule?: string; tz?: string })?.tz ?? "Europe/London";
    if (!rrule) continue;
    const next = nextFireAfter(rrule, now, tz);
    if (next) {
      await admin.from("automations").update({ next_fire_at: next.toISOString() }).eq("id", rule.id);
    }
  }

  // Pass 2: fire due cron rules.
  const { data: due, error } = await admin
    .from("automations")
    .select("id, user_id, trigger_spec, next_fire_at")
    .eq("trigger_kind", "cron")
    .eq("enabled", true)
    .lte("next_fire_at", nowIso)
    .order("next_fire_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[cron/run-automations] query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const fired: Array<{ rule_id: string; result: unknown }> = [];

  for (const rule of due ?? []) {
    try {
      const result = await dispatchTrigger(admin, "cron", rule.user_id, {
        rule_id: rule.id,
        scheduled_for: rule.next_fire_at,
      });
      fired.push({ rule_id: rule.id, result });

      const rrule = (rule.trigger_spec as { rrule?: string; tz?: string })?.rrule;
      const tz = (rule.trigger_spec as { rrule?: string; tz?: string })?.tz ?? "Europe/London";
      const next = rrule ? nextFireAfter(rrule, now, tz) : null;
      await admin
        .from("automations")
        .update({ next_fire_at: next ? next.toISOString() : null })
        .eq("id", rule.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-automations] failed ${rule.id}:`, msg);
      fired.push({ rule_id: rule.id, result: { error: msg } });
    }
  }

  return NextResponse.json({
    ok: true,
    now: nowIso,
    bootstrapped: pending?.length ?? 0,
    fired_count: fired.length,
    fired,
  });
}
