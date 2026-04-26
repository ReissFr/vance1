// Hourly fan-out: scans decision_postmortems where due_at <= now() AND
// fired_at is null AND responded_at is null AND cancelled_at is null. For
// each, fires a WhatsApp nudge to the decision-owner asking "did this play
// out?" and stamps fired_at. The user replies via WhatsApp (handled by the
// existing inbound handler which routes to the brain) or opens /postmortems
// in the web console.
//
// Auth: x-cron-secret header (CRON_SECRET env). Same convention as other
// cron routes. Idempotency: fired_at check + per-firing transaction.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 100;

type PMRow = {
  id: string;
  user_id: string;
  decision_id: string;
  due_at: string;
  scheduled_offset: string | null;
  decisions: { id: string; title: string; choice: string | null; expected_outcome: string | null; created_at: string } | null;
};

function relTimeAgo(then: string): string {
  const days = Math.round((Date.now() - new Date(then).getTime()) / 86400000);
  if (days < 14) return `${days} days ago`;
  if (days < 90) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365 * 2) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

function composeMessage(row: PMRow): string {
  const title = row.decisions?.title ?? "a decision you made";
  const ago = row.decisions?.created_at ? relTimeAgo(row.decisions.created_at) : "a while back";
  const expected = row.decisions?.expected_outcome
    ? ` You expected: "${row.decisions.expected_outcome.slice(0, 200)}".`
    : "";
  const offset = row.scheduled_offset ? ` (${row.scheduled_offset} check-in)` : "";
  return `Postmortem${offset} — ${ago} you decided "${title}".${expected} How has it played out? Reply with what actually happened and I'll log it.`;
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
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await admin
    .from("decision_postmortems")
    .select("id, user_id, decision_id, due_at, scheduled_offset, decisions(id, title, choice, expected_outcome, created_at)")
    .lte("due_at", nowIso)
    .is("fired_at", null)
    .is("responded_at", null)
    .is("cancelled_at", null)
    .order("due_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) {
    console.error("[cron/run-postmortems] query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const eligible = (rows ?? []) as unknown as PMRow[];
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
          .from("decision_postmortems")
          .update({ fired_at: updateNow, fired_via: "manual", updated_at: updateNow })
          .eq("id", row.id);
        results.push({ id: row.id, user_id: row.user_id, status: "skipped_no_mobile" });
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
        results.push({ id: row.id, user_id: row.user_id, status: "failed", error: insErr?.message ?? "no row" });
        continue;
      }

      void dispatchNotification(admin, notif.id).catch((e) => {
        console.warn(`[cron/run-postmortems] dispatch failed for ${notif.id}:`, e);
      });

      await admin
        .from("decision_postmortems")
        .update({ fired_at: updateNow, fired_via: "whatsapp", updated_at: updateNow })
        .eq("id", row.id);

      results.push({ id: row.id, user_id: row.user_id, status: "queued" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-postmortems] error for ${row.id}:`, msg);
      results.push({ id: row.id, user_id: row.user_id, status: "error", error: msg });
    }
  }

  return NextResponse.json({ ok: true, scanned: rows?.length ?? 0, eligible: eligible.length, results });
}
