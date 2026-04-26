// Cancels an in-flight concierge pairing (closes the headful browser window
// without capturing state). Called when the user dismisses the Settings flow.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { cancelPairing } from "@/lib/concierge-pair";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { pair_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.pair_id) {
    return NextResponse.json({ error: "pair_id required" }, { status: 400 });
  }

  try {
    await cancelPairing({ userId: user.id, pairId: body.pair_id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
