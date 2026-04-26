// Kicks off a concierge pairing. Opens a headful Chromium window on the
// machine running Next.js (= the user's Mac in dev) and navigates it to the
// target site's login URL. The user logs in themselves, then calls
// /pair/finish with the pair_id to have the storageState captured.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { SITE_PRESETS, startPairing } from "@/lib/concierge-pair";

export const runtime = "nodejs";

interface Body {
  preset_id?: string;
  custom_url?: string;
  custom_domain?: string;
  custom_name?: string;
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

  if (body.preset_id && !SITE_PRESETS[body.preset_id]) {
    return NextResponse.json({ error: "unknown preset" }, { status: 400 });
  }
  if (!body.preset_id && !(body.custom_url && body.custom_domain && body.custom_name)) {
    return NextResponse.json(
      { error: "either preset_id or (custom_url, custom_domain, custom_name) required" },
      { status: 400 },
    );
  }

  try {
    const result = await startPairing({
      userId: user.id,
      presetId: body.preset_id,
      customUrl: body.custom_url,
      customName: body.custom_name,
      customDomain: body.custom_domain,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[concierge/pair/start] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
