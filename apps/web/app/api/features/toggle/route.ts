// POST { featureId, enabled } → upserts a row in user_features.
// Validates featureId against the code registry so users can't write junk.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { FEATURES_BY_ID } from "@/lib/features";

export const runtime = "nodejs";

interface Body {
  featureId?: string;
  enabled?: boolean;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as Body;
  if (!body.featureId || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!FEATURES_BY_ID[body.featureId]) {
    return NextResponse.json({ error: "unknown feature" }, { status: 404 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin.from("user_features").upsert(
    {
      user_id: user.id,
      feature_id: body.featureId,
      enabled: body.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,feature_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
