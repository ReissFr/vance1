// User-facing trigger: queue a commitments scan task and kick the worker.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ScanBody {
  title?: string;
  query?: string;
  max?: number;
  notify?: boolean;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: ScanBody = {};
  try {
    body = (await req.json()) as ScanBody;
  } catch {}

  const title = body.title ?? "Commitments scan";
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      kind: "commitments_scan",
      prompt: "Scan email for open commitments",
      args: { title, query: body.query, max: body.max, notify: body.notify ?? false },
      device_target: "server",
      status: "queued",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const baseUrl =
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030";

  void fetch(`${baseUrl}/api/tasks/run-commitments-scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_id: data.id }),
  }).catch((e) => {
    console.warn("[commitments/scan] trigger fetch failed:", e);
  });

  return NextResponse.json({ task_id: data.id, status: "queued", title });
}
