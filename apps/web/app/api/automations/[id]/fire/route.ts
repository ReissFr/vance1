// Test-fire an automation on demand. Bypasses trigger matching and the
// per-day rate limit because the user is explicitly asking for this one run.
// Powers the "Test fire" button on /automations.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { fireAutomationDirect } from "@/lib/automation-engine";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const result = await fireAutomationDirect(admin, id, auth.user.id, {});
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
