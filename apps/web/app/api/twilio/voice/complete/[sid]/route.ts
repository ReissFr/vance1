// Final step of an inbound PA call. Twilio hits here after the PA says its
// last line (on hangup, timeout, or error). We mark the voice_calls row
// completed, and if we got anything useful out of the call, fire a WhatsApp
// summary at the owner so they can follow up.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyTwilioSignature } from "@/lib/twilio";
import { dispatchNotification } from "@/lib/notify";
import type { Turn } from "@/lib/pa-voice";

export const runtime = "nodejs";

type Reason = "hangup" | "no_input" | "error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid: callSid } = await params;

  const form = await req.formData().catch(() => null);

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken && form) {
    const paramsForSig: Record<string, string> = {};
    for (const [k, v] of form.entries()) paramsForSig[k] = String(v);
    const sig = req.headers.get("x-twilio-signature");
    const url = publicUrl(req);
    if (!verifyTwilioSignature(authToken, url, paramsForSig, sig)) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }

  const reasonParam = req.nextUrl.searchParams.get("reason");
  const reason: Reason =
    reasonParam === "no_input" || reasonParam === "error" ? reasonParam : "hangup";

  const admin = supabaseAdmin();
  const { data: call } = await admin
    .from("voice_calls")
    .select(
      "id, user_id, from_e164, caller_name, purpose, urgency, summary, turns, status",
    )
    .eq("call_sid", callSid)
    .single();

  if (!call) {
    return xml(`<Response><Hangup/></Response>`);
  }

  // Idempotent: if we already finished this call (Twilio sometimes redirects
  // twice), don't double-send WhatsApp.
  if (call.status !== "in_progress") {
    return xml(`<Response><Hangup/></Response>`);
  }

  const dbStatus =
    reason === "no_input" ? "no_input" : reason === "error" ? "failed" : "completed";

  await admin
    .from("voice_calls")
    .update({ status: dbStatus, completed_at: new Date().toISOString() })
    .eq("id", call.id);

  const turns: Turn[] = Array.isArray(call.turns) ? (call.turns as Turn[]) : [];
  const hasContent = turns.some((t) => t.role === "caller" && t.text.trim().length > 0);

  // Only ping the owner if we actually captured something. A call that
  // immediately dropped with no speech isn't worth a WhatsApp.
  if (hasContent) {
    const { data: profile } = await admin
      .from("profiles")
      .select("mobile_e164")
      .eq("id", call.user_id)
      .single();

    if (profile?.mobile_e164) {
      const body = buildSummary({
        caller_name: call.caller_name,
        from_e164: call.from_e164,
        purpose: call.purpose,
        urgency: call.urgency,
        summary: call.summary,
        reason,
      });

      const { data: notif } = await admin
        .from("notifications")
        .insert({
          user_id: call.user_id,
          channel: "whatsapp",
          to_e164: profile.mobile_e164,
          body,
          status: "queued",
        })
        .select("id")
        .single();

      if (notif) {
        await dispatchNotification(admin, notif.id).catch((e) => {
          console.warn("[voice/complete] dispatchNotification failed:", e);
        });
      }
    }
  }

  return xml(`<Response><Hangup/></Response>`);
}

function buildSummary(opts: {
  caller_name: string | null;
  from_e164: string;
  purpose: string | null;
  urgency: string | null;
  summary: string | null;
  reason: Reason;
}): string {
  const who = opts.caller_name?.trim() || opts.from_e164;
  const urgencyTag =
    opts.urgency === "high" ? "🔴 URGENT" : opts.urgency === "low" ? "🟢" : "🟡";
  const lines: string[] = [`${urgencyTag} Missed call — ${who}`];
  if (opts.summary) lines.push(opts.summary);
  else if (opts.purpose) lines.push(`Re: ${opts.purpose}`);
  if (opts.reason === "no_input") lines.push("(Caller didn't speak — line may have dropped.)");
  if (opts.reason === "error") lines.push("(PA hit an error mid-call — transcript saved.)");
  return lines.join("\n");
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
