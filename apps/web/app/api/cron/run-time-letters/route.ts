// Daily fan-out: scans time_letters where kind='forward' AND
// target_date <= today AND delivered_at is null AND cancelled_at is null
// AND archived_at is null. For each, delivers the sealed letter to the
// user via WhatsApp and stamps delivered_at + delivered_via.
//
// Auth: x-cron-secret header (CRON_SECRET env). Same convention as other
// cron routes. Idempotency: delivered_at check.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 100;

type LetterRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  written_at_date: string;
  target_date: string;
};

function relTime(written: string, target: string): string {
  const ms = new Date(target).getTime() - new Date(written).getTime();
  const days = Math.round(ms / 86400000);
  if (days < 14) return `${days} days ago`;
  if (days < 90) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365 * 2) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

function compose(row: LetterRow): string {
  const ago = relTime(row.written_at_date, row.target_date);
  const heading = `Time letter — ${ago} you sealed this for today.`;
  const titleLine = row.title ? `\n\n"${row.title}"` : "";
  const bodyTrimmed = row.body.length > 1200 ? row.body.slice(0, 1200) + "…" : row.body;
  return `${heading}${titleLine}\n\n${bodyTrimmed}`;
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
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows, error } = await admin
    .from("time_letters")
    .select("id, user_id, title, body, written_at_date, target_date")
    .eq("kind", "forward")
    .lte("target_date", today)
    .is("delivered_at", null)
    .is("cancelled_at", null)
    .is("archived_at", null)
    .order("target_date", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) {
    console.error("[cron/run-time-letters] query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const eligible = (rows ?? []) as LetterRow[];
  const profileCache = new Map<string, string | null>();
  const results: Array<{ id: string; user_id: string; status: string; error?: string }> = [];

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

      const updateNow = new Date().toISOString();

      if (!mobile) {
        await admin
          .from("time_letters")
          .update({ delivered_at: updateNow, delivered_via: "manual" })
          .eq("id", row.id);
        results.push({ id: row.id, user_id: row.user_id, status: "delivered_no_mobile" });
        continue;
      }

      const body = compose(row);
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
        results.push({ id: row.id, user_id: row.user_id, status: "failed", error: insErr?.message ?? "no row" });
        continue;
      }

      void dispatchNotification(admin, notif.id).catch((e) => {
        console.warn(`[cron/run-time-letters] dispatch failed for ${notif.id}:`, e);
      });

      await admin
        .from("time_letters")
        .update({ delivered_at: updateNow, delivered_via: "whatsapp" })
        .eq("id", row.id);

      results.push({ id: row.id, user_id: row.user_id, status: "queued" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-time-letters] error for ${row.id}:`, msg);
      results.push({ id: row.id, user_id: row.user_id, status: "error", error: msg });
    }
  }

  return NextResponse.json({ ok: true, scanned: rows?.length ?? 0, eligible: eligible.length, results });
}
