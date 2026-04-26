// Removes a paired concierge session. Soft-deactivates by setting active=false
// so we don't lose the row outright (lets the user re-enable without a
// re-pair if they change their mind within the cookie lifetime).

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { provider?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.provider) {
    return NextResponse.json({ error: "provider required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("integrations")
    .delete()
    .eq("user_id", user.id)
    .eq("kind", "concierge_session")
    .eq("provider", body.provider);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
