// Wins log CRUD. GET returns rows + counts for last 7d / 30d / all-time and
// a sum of amount_cents per window.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type WinRow = {
  id: string;
  text: string;
  kind: "shipped" | "sale" | "milestone" | "personal" | "other";
  amount_cents: number | null;
  related_to: string | null;
  created_at: string;
};

const VALID_KINDS = new Set(["shipped", "sale", "milestone", "personal", "other"]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(500, limitParam) : 100;
  const kind = req.nextUrl.searchParams.get("kind");

  let q = supabase
    .from("wins")
    .select("id, text, kind, amount_cents, related_to, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (kind && VALID_KINDS.has(kind)) q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as WinRow[];

  const now = Date.now();
  const day = 86400000;
  let count7 = 0, count30 = 0, sum7 = 0, sum30 = 0, sumAll = 0;
  for (const r of rows) {
    const age = now - new Date(r.created_at).getTime();
    const amt = r.amount_cents ?? 0;
    sumAll += amt;
    if (age <= 30 * day) {
      count30 += 1;
      sum30 += amt;
      if (age <= 7 * day) {
        count7 += 1;
        sum7 += amt;
      }
    }
  }

  return NextResponse.json({
    rows,
    stats: {
      total: rows.length,
      last_7d: { count: count7, amount_cents: sum7 },
      last_30d: { count: count30, amount_cents: sum30 },
      all_time_amount_cents: sumAll,
    },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const kind = typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "other";
  const amountCents =
    typeof body.amount_cents === "number" && Number.isFinite(body.amount_cents)
      ? Math.round(body.amount_cents)
      : null;
  const relatedTo = typeof body.related_to === "string" ? body.related_to.trim().slice(0, 200) || null : null;

  const { data, error } = await supabase
    .from("wins")
    .insert({ user_id: user.id, text, kind, amount_cents: amountCents, related_to: relatedTo })
    .select("id, text, kind, amount_cents, related_to, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ win: data });
}
