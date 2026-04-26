// Finishes a concierge pairing: captures Playwright storageState from the
// headful browser the user just logged into, persists it to an integrations
// row (kind='concierge_session', provider=<site id>), closes the browser.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { finishPairing } from "@/lib/concierge-pair";

export const runtime = "nodejs";

interface Body {
  pair_id?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.pair_id) {
    return NextResponse.json({ error: "pair_id required" }, { status: 400 });
  }

  try {
    const res = await finishPairing({ userId: user.id, pairId: body.pair_id });

    const admin = supabaseAdmin();
    const { error: upsertErr } = await admin
      .from("integrations")
      .upsert(
        {
          user_id: user.id,
          kind: "concierge_session",
          provider: res.provider,
          credentials: {
            storage_state: res.storageState,
            domain: res.domain,
            display_name: res.display_name,
          },
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,kind,provider" },
      );
    if (upsertErr) {
      console.error("[concierge/pair/finish] upsert failed:", upsertErr);
      return NextResponse.json({ error: "db_upsert" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      provider: res.provider,
      display_name: res.display_name,
      domain: res.domain,
      cookie_count: res.cookie_count,
      origin_count: res.origin_count,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
