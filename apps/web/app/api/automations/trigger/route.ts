// Generic trigger ingestion endpoint. External sources (iOS Shortcuts for
// geofences, Gmail push, Stripe webhooks, bank webhooks, etc.) POST here with
// a trigger kind + payload. The engine fans out to matching automations.
//
// Auth: caller must include x-trigger-secret matching AUTOMATION_TRIGGER_SECRET.
// (Per-source webhooks like Stripe verify their own signatures upstream and
// then call into dispatchTrigger directly — this endpoint is for the iOS
// Shortcuts case and other simple producers.)

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchTrigger, type TriggerKind } from "@/lib/automation-engine";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_KINDS: TriggerKind[] = [
  "cron",
  "location_arrived",
  "location_left",
  "email_received",
  "bank_txn",
  "payment_received",
  "calendar_event",
];

type Body = {
  kind?: string;
  user_id?: string;
  payload?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const secret = process.env.AUTOMATION_TRIGGER_SECRET;
  if (secret) {
    const provided = req.headers.get("x-trigger-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const kind = body.kind;
  if (!kind || !VALID_KINDS.includes(kind as TriggerKind)) {
    return NextResponse.json(
      { ok: false, error: `kind must be one of ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!body.user_id) {
    return NextResponse.json({ ok: false, error: "user_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const result = await dispatchTrigger(admin, kind as TriggerKind, body.user_id, body.payload ?? {});

  return NextResponse.json({ ok: true, ...result });
}
