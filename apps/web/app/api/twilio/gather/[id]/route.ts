// Handles the DTMF digit Twilio collected from the <Gather> in our TwiML.
// If the user pressed 1, flip the linked task from 'needs_approval' back to
// 'running' — same effect as hitting Approve in the web UI. Any other digit
// (or no digit) just hangs up without acting.
//
// Kept deliberately narrow: only handles concierge tasks, because other kinds
// (writer/outreach/inbox) need additional input (recipient, selection, etc.)
// that can't be captured via a keypad.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { escapeXml, verifyTwilioSignature } from "@/lib/twilio";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: notificationId } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) return xml(`<Response><Say>Sorry, no input received.</Say><Hangup/></Response>`);

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const paramsForSig: Record<string, string> = {};
    for (const [k, v] of form.entries()) paramsForSig[k] = String(v);
    const sig = req.headers.get("x-twilio-signature");
    const url = publicUrl(req);
    if (!verifyTwilioSignature(authToken, url, paramsForSig, sig)) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }

  const digits = String(form.get("Digits") ?? "").trim();

  const admin = supabaseAdmin();
  const { data: notif } = await admin
    .from("notifications")
    .select("id, user_id, task_id")
    .eq("id", notificationId)
    .single();

  if (!notif?.task_id) {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">This call is no longer linked to an active task. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  if (digits !== "1") {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">Okay, no change made. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  const { data: task } = await admin
    .from("tasks")
    .select("id, kind, status, user_id")
    .eq("id", notif.task_id)
    .eq("user_id", notif.user_id)
    .single();

  if (!task) {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">Task not found. Goodbye.</Say><Hangup/></Response>`,
    );
  }
  if (task.status !== "needs_approval") {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">This task is no longer waiting for approval. Goodbye.</Say><Hangup/></Response>`,
    );
  }
  if (task.kind !== "concierge") {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">This task needs more than one button to approve. Please open the app. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  const { error: upErr } = await admin
    .from("tasks")
    .update({ status: "running", error: null, needs_approval_at: null })
    .eq("id", task.id);

  if (upErr) {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">Sorry, I couldn't approve that. Please try the app. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  return xml(
    `<Response><Say voice="Polly.Matthew-Neural">${escapeXml("Approved. The booking will go through now. Goodbye.")}</Say><Hangup/></Response>`,
  );
}

function publicUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
  return req.nextUrl.toString();
}

function xml(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}
