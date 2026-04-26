// User-facing trigger: queue a subscription scan task and kick off the
// worker fire-and-forget. Mirrors /api/receipts/scan. Returns task_id so the
// UI can show a running indicator.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ScanBody {
  title?: string;
  days?: number;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: ScanBody = {};
  try {
    body = (await req.json()) as ScanBody;
  } catch {
    // empty body is fine
  }

  const title = body.title ?? "Subscription scan";

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      kind: "subscription_scan",
      prompt: "Scan email + bank for recurring charges",
      args: {
        title,
        days: body.days ?? 90,
      },
      device_target: "server",
      status: "queued",
    })
    .select("id, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const baseUrl =
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030";

  void fetch(`${baseUrl}/api/tasks/run-subscription-scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_id: data.id }),
  }).catch((e) => {
    console.warn("[subscriptions/scan] trigger fetch failed:", e);
  });

  return NextResponse.json({ task_id: data.id, status: "queued", title });
}
