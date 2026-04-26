// Bulk-operate on commitments. Accepts a list of IDs and an action — used by
// the /commitments console's checkbox selection. Counterpart to the per-row
// PATCH/DELETE in ../[id]/route.ts; keeps the client from firing N round-trips.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface BulkBody {
  ids?: unknown;
  action?: unknown;
}

const ALLOWED_STATUSES = new Set(["done", "cancelled", "open"]);

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: BulkBody = {};
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = rawIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return NextResponse.json({ error: "no ids provided" }, { status: 400 });
  if (ids.length > 500) return NextResponse.json({ error: "too many ids (max 500)" }, { status: 400 });

  const action = typeof body.action === "string" ? body.action : "";
  const nowIso = new Date().toISOString();

  if (action === "delete") {
    const { error } = await supabase
      .from("commitments")
      .delete()
      .in("id", ids)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  if (ALLOWED_STATUSES.has(action)) {
    const { error } = await supabase
      .from("commitments")
      .update({ status: action, updated_at: nowIso })
      .in("id", ids)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  return NextResponse.json(
    { error: `unknown action '${action}' — expected one of: done, cancelled, open, delete` },
    { status: 400 },
  );
}
