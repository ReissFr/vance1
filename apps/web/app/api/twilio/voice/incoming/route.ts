// Entry point for inbound PA calls. Twilio hits this when someone's call is
// forwarded to our phone number. We greet the caller, open a voice_calls row,
// and hand Twilio a <Gather input="speech"> that will POST the caller's first
// utterance to the turn endpoint.
//
// The user's Twilio phone number must be configured in Twilio Console →
// Phone Numbers → (number) → Voice Configuration:
//    Webhook: https://<public base>/api/twilio/voice/incoming   (POST)
//    Status Callback: https://<public base>/api/twilio/status    (POST)

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { escapeXml, verifyTwilioSignature } from "@/lib/twilio";
import { openingLine } from "@/lib/pa-voice";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return xml(`<Response><Say>Sorry, something went wrong.</Say><Hangup/></Response>`);

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

  const callSid = String(form.get("CallSid") ?? "");
  const from = String(form.get("From") ?? "");
  const to = String(form.get("To") ?? "");
  if (!callSid) {
    return xml(`<Response><Say>Sorry, something went wrong.</Say><Hangup/></Response>`);
  }

  // Figure out which user owns this destination number. For a single-user MVP
  // we match TWILIO_PHONE_NUMBER to the one profile that has a mobile set.
  // When we go multi-tenant, store per-user Twilio numbers in a table.
  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .not("mobile_e164", "is", null)
    .limit(1)
    .single();
  if (!profile) {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">This number isn't configured yet. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  await admin
    .from("voice_calls")
    .upsert(
      {
        user_id: profile.id,
        call_sid: callSid,
        from_e164: from,
        to_e164: to,
        status: "in_progress",
        turns: [],
      },
      { onConflict: "call_sid" },
    );

  const publicBase = (
    process.env.TWILIO_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ""
  ).replace(/\/+$/, "");
  const turnUrl = `${publicBase}/api/twilio/voice/turn/${callSid}`;

  // Gather with speech input. speechTimeout="auto" lets Twilio detect end-of-
  // utterance automatically. enhanced="true" + speechModel phone_call improves
  // accuracy on narrowband phone audio at a small cost premium.
  return xml(
    `<Response>` +
      `<Say voice="Polly.Amy-Neural">${escapeXml(openingLine())}</Say>` +
      `<Gather input="speech" action="${escapeXml(turnUrl)}" method="POST"` +
        ` speechTimeout="auto" enhanced="true" speechModel="phone_call" language="en-GB">` +
      `</Gather>` +
      `<Redirect method="POST">${escapeXml(`${publicBase}/api/twilio/voice/complete/${callSid}?reason=no_input`)}</Redirect>` +
    `</Response>`,
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
