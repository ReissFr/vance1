// Daily cron that walks every user with active budgets and fires WhatsApp
// alerts at the 80% warn + 100% breach thresholds. Idempotent per month per
// threshold via the `budget_alerts` dedup table.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runBudgetChecks } from "@/lib/budget-check";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("x-cron-secret") !== secret) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }
  const admin = supabaseAdmin();
  const result = await runBudgetChecks(admin);
  return NextResponse.json({ ok: true, ...result });
}
