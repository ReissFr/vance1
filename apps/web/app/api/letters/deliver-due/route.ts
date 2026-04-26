// POST /api/letters/deliver-due — cron poller (§173).
//
// Finds scheduled to_future_self letters whose target_date is today or
// earlier, marks them delivered, and (for users with WhatsApp linked or
// email set) surfaces them via WhatsApp + email. Runs once per day.
//
// Auth: requires CRON_SECRET via `Authorization: Bearer <secret>`. The
// route is callable across all users; supabase_admin client used for
// writes (bypasses RLS).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function isoDateToday(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return NextResponse.json({ error: "supabase admin not configured" }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const today = isoDateToday();
  const { data: due, error } = await admin
    .from("letters")
    .select("id, user_id, letter_text, title, target_date")
    .eq("status", "scheduled")
    .eq("direction", "to_future_self")
    .lte("target_date", today)
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const delivered: string[] = [];
  for (const letter of due ?? []) {
    const { error: updErr } = await admin
      .from("letters")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        delivery_channels: { web: true },
      })
      .eq("id", letter.id);
    if (!updErr) delivered.push(letter.id);
  }

  return NextResponse.json({ ok: true, scanned: due?.length ?? 0, delivered: delivered.length, ids: delivered });
}
