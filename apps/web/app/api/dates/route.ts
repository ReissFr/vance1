// Important dates CRUD. GET sorts by next occurrence (computed in-process)
// and supports ?days=N to limit to upcoming N days. POST creates a row.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Row = {
  id: string;
  name: string;
  date_type: "birthday" | "anniversary" | "custom";
  month: number;
  day: number;
  year: number | null;
  lead_days: number;
  last_notified_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// Days from today (local) until the next occurrence of (month, day).
// Today = 0; tomorrow = 1; yesterday's same date returns ~365.
function daysUntilNext(month: number, day: number): number {
  const now = new Date();
  const todayY = now.getFullYear();
  let next = new Date(todayY, month - 1, day);
  next.setHours(0, 0, 0, 0);
  const today = new Date(todayY, now.getMonth(), now.getDate());
  if (next < today) next = new Date(todayY + 1, month - 1, day);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

function turningAge(year: number | null, month: number, day: number): number | null {
  if (!year) return null;
  const days = daysUntilNext(month, day);
  const now = new Date();
  const nextYear =
    days === 0 || new Date(now.getFullYear(), month - 1, day) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
      ? now.getFullYear()
      : now.getFullYear() + 1;
  return nextYear - year;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const horizon = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(365, daysParam) : null;

  const { data, error } = await supabase
    .from("important_dates")
    .select("id, name, date_type, month, day, year, lead_days, last_notified_at, note, created_at, updated_at")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  const enriched = rows
    .map((r) => ({
      ...r,
      days_until_next: daysUntilNext(r.month, r.day),
      turning_age: turningAge(r.year, r.month, r.day),
    }))
    .filter((r) => (horizon == null ? true : r.days_until_next <= horizon))
    .sort((a, b) => a.days_until_next - b.days_until_next);

  return NextResponse.json({ rows: enriched });
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

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const month = Number(body.month);
  const day = Number(body.day);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "month 1-12 required" }, { status: 400 });
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return NextResponse.json({ error: "day 1-31 required" }, { status: 400 });
  }

  const dateType =
    typeof body.date_type === "string" && ["birthday", "anniversary", "custom"].includes(body.date_type)
      ? body.date_type
      : "birthday";

  const yearRaw = body.year == null ? null : Number(body.year);
  const year =
    yearRaw != null && Number.isInteger(yearRaw) && yearRaw >= 1900 && yearRaw <= 2100 ? yearRaw : null;

  const leadRaw = body.lead_days == null ? 7 : Number(body.lead_days);
  const leadDays =
    Number.isInteger(leadRaw) && leadRaw >= 0 && leadRaw <= 60 ? leadRaw : 7;

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

  const { data, error } = await supabase
    .from("important_dates")
    .insert({
      user_id: user.id,
      name,
      date_type: dateType,
      month,
      day,
      year,
      lead_days: leadDays,
      note: note || null,
    })
    .select("id, name, date_type, month, day, year, lead_days, note, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}
