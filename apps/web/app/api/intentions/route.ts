// Daily intention CRUD. POST upserts today's intention; GET returns
// today + the last 14 days for the timeline.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type IntentionRow = {
  id: string;
  log_date: string;
  text: string;
  completed_at: string | null;
  carried_from: string | null;
  created_at: string;
  updated_at: string;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const since = new Date();
  since.setDate(since.getDate() - 14);
  const { data, error } = await supabase
    .from("intentions")
    .select("id, log_date, text, completed_at, carried_from, created_at, updated_at")
    .eq("user_id", user.id)
    .gte("log_date", ymd(since))
    .order("log_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as IntentionRow[];
  const todayKey = ymd(new Date());
  const today = rows.find((r) => r.log_date === todayKey) ?? null;

  // Carry-forward candidate: most recent past row that wasn't completed.
  let suggested: IntentionRow | null = null;
  if (!today) {
    suggested = rows.find((r) => r.log_date !== todayKey && r.completed_at == null) ?? null;
  }

  return NextResponse.json({ today, rows, suggested });
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

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 280) : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const carriedFrom = typeof body.carried_from === "string" ? body.carried_from : null;

  const today = ymd(new Date());
  const { data, error } = await supabase
    .from("intentions")
    .upsert(
      {
        user_id: user.id,
        log_date: today,
        text,
        carried_from: carriedFrom,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,log_date" },
    )
    .select("id, log_date, text, completed_at, carried_from, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ intention: data });
}
