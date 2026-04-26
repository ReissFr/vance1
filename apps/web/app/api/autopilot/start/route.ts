// Kick off an autopilot run. Inserts the row, then fire-and-forgets the
// runner on the server process. Client should then subscribe to
// autopilot_runs via Supabase Realtime to watch live.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { runAutopilot } from "@/lib/autopilot-run";

export const runtime = "nodejs";
// Autopilot loops can run 5-15 minutes; this route only kicks off. The heavy
// loop is fire-and-forget, but the initial insert + first round can take a bit.
export const maxDuration = 60;

type StartBody = { goal?: string };

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const goal = (body.goal ?? "").trim();
  if (!goal) return NextResponse.json({ ok: false, error: "goal required" }, { status: 400 });
  if (goal.length > 4000) {
    return NextResponse.json({ ok: false, error: "goal too long (max 4000 chars)" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from("autopilot_runs")
    .insert({ user_id: user.id, goal, status: "queued" })
    .select("id")
    .single();
  if (error || !row) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  // Fire-and-forget — runner writes progress into autopilot_runs.steps.
  void runAutopilot({ admin, userId: user.id, runId: row.id }).catch((e) => {
    console.error(`[autopilot] runner crashed for ${row.id}:`, e);
  });

  return NextResponse.json({ ok: true, id: row.id });
}
