// List + upsert daily check-ins (energy/mood/focus 1-5 + note).
// Upsert keys on (user_id, log_date) — POST today multiple times = last wins.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CheckinRow = {
  id: string;
  log_date: string;
  energy: number | null;
  mood: number | null;
  focus: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

function clamp1to5(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < 1 || n > 5) return null;
  return n;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 90);

  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  const { data, error } = await supabase
    .from("daily_checkins")
    .select("id, log_date, energy, mood, focus, note, created_at, updated_at")
    .eq("user_id", user.id)
    .gte("log_date", ymd(since))
    .order("log_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as CheckinRow[];
  const byDate = new Map(rows.map((r) => [r.log_date, r]));

  const today = new Date();
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const key = ymd(d);
    const row = byDate.get(key);
    return {
      date: key,
      energy: row?.energy ?? null,
      mood: row?.mood ?? null,
      focus: row?.focus ?? null,
    };
  });

  return NextResponse.json({
    today: byDate.get(ymd(today)) ?? null,
    rows,
    series,
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

  const date = typeof body.log_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.log_date)
    ? body.log_date
    : ymd(new Date());

  const energy = clamp1to5(body.energy);
  const mood = clamp1to5(body.mood);
  const focus = clamp1to5(body.focus);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;

  if (energy == null && mood == null && focus == null && !note) {
    return NextResponse.json({ error: "nothing to save" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("daily_checkins")
    .upsert(
      {
        user_id: user.id,
        log_date: date,
        energy,
        mood,
        focus,
        note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,log_date" },
    )
    .select("id, log_date, energy, mood, focus, note, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ checkin: data });
}
