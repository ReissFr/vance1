// Rejects a writer task draft — marks status as cancelled. Simple counterpart
// to /approve; no destination-specific work.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("tasks")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", auth.user.id)
    .eq("status", "needs_approval");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
