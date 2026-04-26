// Sets the user's autonomous booking spend limit. When the concierge agent
// reaches a confirmation screen, it compares the purchase amount against this
// limit: under → clicks confirm autonomously; over → pauses to needs_approval.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { gbp?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const gbp = Number(body.gbp);
  if (!Number.isFinite(gbp) || gbp < 0 || gbp > 10000) {
    return NextResponse.json({ error: "gbp must be between 0 and 10000" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("profiles")
    .update({ concierge_auto_limit_gbp: gbp })
    .eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, auto_limit_gbp: gbp });
}
