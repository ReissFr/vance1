// List the user's receipts. Supports filtering by category and archive
// state, plus a basic month-bucket filter for the "July totals" UI view.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const archived = searchParams.get("archived") === "true";
  const limit = Math.min(Number(searchParams.get("limit") ?? 150), 500);

  let q = supabase
    .from("receipts")
    .select(
      "id, merchant, amount, currency, purchased_at, category, description, order_ref, confidence, archived, created_at",
    )
    .eq("archived", archived)
    .order("purchased_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (category) q = q.eq("category", category);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ receipts: data ?? [] });
}
