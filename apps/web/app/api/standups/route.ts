// Standups CRUD. GET supports ?days= (default 14, max 90).
// POST upserts on (user_id, log_date) — one row per day, replacing existing.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function trimNullable(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const daysParam = req.nextUrl.searchParams.get("days");
  const days = Math.min(Math.max(Number(daysParam) || 14, 1), 90);
  const since = new Date(Date.now() - days * 86400000);
  const sinceYmd = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("standups")
    .select("id, log_date, yesterday, today, blockers, created_at, updated_at")
    .eq("user_id", user.id)
    .gte("log_date", sinceYmd)
    .order("log_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
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

  const yesterday = trimNullable(body.yesterday, 4000);
  const today = trimNullable(body.today, 4000);
  const blockers = trimNullable(body.blockers, 4000);

  if (!yesterday && !today && !blockers) {
    return NextResponse.json({ error: "at least one field required" }, { status: 400 });
  }

  const logDate = typeof body.log_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.log_date)
    ? body.log_date
    : todayYmd();

  const { data, error } = await supabase
    .from("standups")
    .upsert(
      {
        user_id: user.id,
        log_date: logDate,
        yesterday,
        today,
        blockers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,log_date" },
    )
    .select("id, log_date, yesterday, today, blockers, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ standup: data });
}
