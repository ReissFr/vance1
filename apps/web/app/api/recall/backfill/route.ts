// POST: run a fresh ingestion pass for the signed-in user (Gmail, Calendar,
// Chat). Called from the /recall page after first enabling Total Recall.
// Returns per-source counts so the UI can report "ingested 247 emails, 34
// calendar events, 612 chat turns".

import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { syncAll } from "@/lib/recall";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const results = await syncAll(admin, user.id);
  return NextResponse.json({ ok: true, results });
}
