// Enable / disable / delete an automation from the /watchers page.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { id?: string; action?: "enable" | "disable" | "delete" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = body.id;
  const action = body.action;
  if (!id || !action) return NextResponse.json({ ok: false, error: "missing id/action" }, { status: 400 });

  if (action === "delete") {
    const { error } = await supabase.from("automations").delete().eq("id", id).eq("user_id", user.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  const { error } = await supabase
    .from("automations")
    .update({ enabled: action === "enable", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, action });
}
