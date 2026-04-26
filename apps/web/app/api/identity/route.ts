// GET /api/identity — list identity claims.
// Query: ?kind=am|value|refuse|becoming|aspire
//        ?status=active|dormant|contradicted|retired|all (default: not retired)
//        ?limit=N (default 200)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const KINDS = ["am", "value", "refuse", "becoming", "aspire"];
const STATUSES = ["active", "dormant", "contradicted", "retired"];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const status = url.searchParams.get("status") ?? "default";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "200", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

  let q = supabase
    .from("identity_claims")
    .select("id, kind, statement, normalized_key, occurrences, first_seen_at, last_seen_at, source_refs, status, contradiction_note, user_note, pinned")
    .eq("user_id", user.id);

  if (kind && KINDS.includes(kind)) q = q.eq("kind", kind);
  if (status === "default") q = q.neq("status", "retired");
  else if (status !== "all" && STATUSES.includes(status)) q = q.eq("status", status);

  q = q.order("pinned", { ascending: false }).order("occurrences", { ascending: false }).order("last_seen_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ claims: data ?? [] });
}
