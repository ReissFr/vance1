// Daily fan-out: scans every user's important_dates rows and fires a WhatsApp
// nudge for any date where days_until_next <= lead_days AND we haven't already
// nudged for this occurrence (last_notified_at older than lead_days). Stamps
// last_notified_at = today after each successful queue.
//
// Auth: same CRON_SECRET header convention as the other cron routes.
// Idempotency: the last_notified_at gate means a duplicate fire on the same
// day is a no-op.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 500;

type DateRow = {
  id: string;
  user_id: string;
  name: string;
  date_type: "birthday" | "anniversary" | "custom";
  month: number;
  day: number;
  year: number | null;
  lead_days: number;
  last_notified_at: string | null;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

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
  const now = new Date();
  const currentY = now.getFullYear();
  const thisYear = new Date(currentY, month - 1, day);
  const today = new Date(currentY, now.getMonth(), now.getDate());
  const nextYear = thisYear < today ? currentY + 1 : currentY;
  return nextYear - year;
}

function composeMessage(row: DateRow): string {
  const days = daysUntilNext(row.month, row.day);
  const age = turningAge(row.year, row.month, row.day);
  const when =
    days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;

  if (row.date_type === "birthday") {
    const ageBit = age != null ? ` (turning ${age})` : "";
    return `Birthday alert — ${row.name}${ageBit} ${when}. Want me to draft a message or remind you to pick something up?`;
  }
  if (row.date_type === "anniversary") {
    return `Anniversary alert — ${row.name} ${when}. Want me to put something on the calendar?`;
  }
  return `Heads up — ${row.name} ${when}.`;
}

export async function POST(req: NextRequest) {
  return checkAndRun(req);
}

export async function GET(req: NextRequest) {
  return checkAndRun(req);
}

async function checkAndRun(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  return handle();
}

async function handle() {
  const admin = supabaseAdmin();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today);

  const { data: rows, error } = await admin
    .from("important_dates")
    .select("id, user_id, name, date_type, month, day, year, lead_days, last_notified_at")
    .limit(BATCH_LIMIT);
  if (error) {
    console.error("[cron/run-birthday-nudges] query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const eligible: DateRow[] = [];
  for (const r of (rows ?? []) as DateRow[]) {
    const days = daysUntilNext(r.month, r.day);
    if (days < 0 || days > r.lead_days) continue;
    if (r.last_notified_at) {
      const last = new Date(r.last_notified_at + "T00:00:00");
      const diffDays = Math.round((today.getTime() - last.getTime()) / 86400000);
      if (diffDays <= r.lead_days) continue;
    }
    eligible.push(r);
  }

  const profileCache = new Map<string, string | null>();
  const results: Array<{ id: string; user_id: string; name: string; status: string; error?: string }> = [];

  for (const row of eligible) {
    try {
      let mobile: string | null;
      if (profileCache.has(row.user_id)) {
        mobile = profileCache.get(row.user_id) ?? null;
      } else {
        const { data: profile } = await admin
          .from("profiles")
          .select("mobile_e164")
          .eq("id", row.user_id)
          .single();
        mobile = profile?.mobile_e164 ?? null;
        profileCache.set(row.user_id, mobile);
      }
      if (!mobile) {
        results.push({ id: row.id, user_id: row.user_id, name: row.name, status: "skipped", error: "no mobile_e164" });
        continue;
      }

      const body = composeMessage(row);
      const { data: notif, error: insErr } = await admin
        .from("notifications")
        .insert({
          user_id: row.user_id,
          channel: "whatsapp",
          to_e164: mobile,
          body,
          status: "queued",
        })
        .select("id")
        .single();
      if (insErr || !notif) {
        results.push({ id: row.id, user_id: row.user_id, name: row.name, status: "failed", error: insErr?.message ?? "no row" });
        continue;
      }

      void dispatchNotification(admin, notif.id).catch((e) => {
        console.warn(`[cron/run-birthday-nudges] dispatch failed for ${notif.id}:`, e);
      });

      await admin
        .from("important_dates")
        .update({ last_notified_at: todayStr, updated_at: new Date().toISOString() })
        .eq("id", row.id);

      results.push({ id: row.id, user_id: row.user_id, name: row.name, status: "queued" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-birthday-nudges] error for ${row.id}:`, msg);
      results.push({ id: row.id, user_id: row.user_id, name: row.name, status: "error", error: msg });
    }
  }

  return NextResponse.json({ ok: true, scanned: rows?.length ?? 0, eligible: eligible.length, results });
}
