// Twilio status callback. Configure this URL on the Twilio phone number (for
// SMS) and on outbound calls (CallStatusCallback) so we can write final
// delivered/failed/no-answer state back to the notifications row.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyTwilioSignature } from "@/lib/twilio";

export const runtime = "nodejs";

// Map Twilio's status strings to our notifications.status check constraint.
// Anything else falls through unchanged.
const MESSAGE_STATUS_MAP: Record<string, string> = {
  queued: "queued",
  sending: "in_progress",
  sent: "sent",
  delivered: "delivered",
  undelivered: "failed",
  failed: "failed",
};
const CALL_STATUS_MAP: Record<string, string> = {
  queued: "queued",
  initiated: "in_progress",
  ringing: "in_progress",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  canceled: "cancelled",
  failed: "failed",
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const sig = req.headers.get("x-twilio-signature");
    if (!verifyTwilioSignature(authToken, publicUrl(req), params, sig)) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }

  const sid = params.MessageSid || params.CallSid;
  if (!sid) return new NextResponse("", { status: 204 });

  const rawStatus = params.MessageStatus || params.CallStatus || "";
  const isCall = Boolean(params.CallSid);
  const mapped = (isCall ? CALL_STATUS_MAP : MESSAGE_STATUS_MAP)[rawStatus] ?? null;
  if (!mapped) return new NextResponse("", { status: 204 });

  const admin = supabaseAdmin();
  const update: Record<string, unknown> = { status: mapped };
  if (mapped === "delivered" || mapped === "completed" || mapped === "failed" || mapped === "no_answer" || mapped === "busy" || mapped === "cancelled") {
    update.completed_at = new Date().toISOString();
  }
  if (params.ErrorMessage) update.error = params.ErrorMessage;

  await admin.from("notifications").update(update).eq("provider_sid", sid);

  return new NextResponse("", { status: 204 });
}

function publicUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
  return req.nextUrl.toString();
}
