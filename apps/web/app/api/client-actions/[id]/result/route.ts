// Desktop app posts here after executing a pending_client_action.
// The body carries the outcome; we write it back so the brain (which may
// still be polling in the original request) can pick it up.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ResultBody {
  status: "completed" | "failed";
  result?: unknown;
  error?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as ResultBody;
  if (body.status !== "completed" && body.status !== "failed") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("pending_client_actions")
    .select("id, user_id, status")
    .eq("id", id)
    .single();
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.status === "completed" || row.status === "failed") {
    return NextResponse.json({ ok: true, alreadyFinal: true });
  }

  const update: Record<string, unknown> = {
    status: body.status,
    completed_at: new Date().toISOString(),
  };
  if (body.result !== undefined) update.result = body.result;
  if (body.error) update.error = body.error;
  await admin.from("pending_client_actions").update(update).eq("id", id);

  return NextResponse.json({ ok: true });
}
