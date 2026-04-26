// Log + list focus (deep-work) sessions. Each row is one timer block
// started from /focus. Rows are created on Start; actual_seconds +
// completed_fully are patched on Stop / natural end via PATCH.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  planned_seconds: number;
  actual_seconds: number | null;
  topic: string | null;
  completed_fully: boolean;
};

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function ymdUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data } = await supabase
    .from("focus_sessions")
    .select("id, started_at, ended_at, planned_seconds, actual_seconds, topic, completed_fully")
    .eq("user_id", user.id)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false });

  const sessions = (data ?? []) as SessionRow[];

  // Per-day totals for the last 7 days (UTC) — cheap + enough for a sparkline.
  const today = startOfDayUTC(new Date());
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return { date: ymdUTC(d), minutes: 0 };
  });
  const byKey = new Map(last7.map((x) => [x.date, x]));

  let weekMinutes = 0;
  let todayMinutes = 0;
  const todayKey = ymdUTC(today);
  for (const s of sessions) {
    const secs = s.actual_seconds ?? 0;
    if (secs <= 0) continue;
    const key = ymdUTC(new Date(s.started_at));
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.minutes += Math.round(secs / 60);
      weekMinutes += Math.round(secs / 60);
    }
    if (key === todayKey) todayMinutes += Math.round(secs / 60);
  }

  return NextResponse.json({
    sessions: sessions.slice(0, 20),
    last_7_days: last7,
    week_minutes: weekMinutes,
    today_minutes: todayMinutes,
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

  const planned =
    typeof body.planned_seconds === "number" && body.planned_seconds > 0
      ? Math.round(body.planned_seconds)
      : 0;
  if (planned < 60 || planned > 60 * 60 * 4) {
    return NextResponse.json({ error: "planned_seconds out of range" }, { status: 400 });
  }
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 300) : null;

  const { data, error } = await supabase
    .from("focus_sessions")
    .insert({
      user_id: user.id,
      planned_seconds: planned,
      topic: topic || null,
    })
    .select("id, started_at, planned_seconds, topic")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
