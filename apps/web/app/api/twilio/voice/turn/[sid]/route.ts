// Per-turn handler for inbound PA calls. Twilio POSTs here after each
// <Gather input="speech"> with SpeechResult=<transcription>. We append the
// caller utterance to the voice_calls.turns array, ask Claude what to say
// next, append the agent turn, and return a TwiML response that either:
//   - speaks the reply and re-gathers (continue)
//   - speaks the reply and redirects to /complete (hangup)

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { escapeXml, verifyTwilioSignature } from "@/lib/twilio";
import { paTurn, timeoutLine, type Turn } from "@/lib/pa-voice";

export const runtime = "nodejs";
// PA turn = Twilio STT round-trip + Claude call. Bumped above Next's default
// 15s so a slow Haiku response doesn't trip Twilio's retry.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid: callSid } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) return xml(`<Response><Hangup/></Response>`);

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

  const publicBase = (
    process.env.TWILIO_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ""
  ).replace(/\/+$/, "");

  const utterance = String(form.get("SpeechResult") ?? "").trim();
  const confidence = Number(form.get("Confidence") ?? "0");

  const admin = supabaseAdmin();
  const { data: call } = await admin
    .from("voice_calls")
    .select("id, user_id, from_e164, turns")
    .eq("call_sid", callSid)
    .single();

  if (!call) {
    return xml(`<Response><Say voice="Polly.Matthew-Neural">Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`);
  }

  // No speech captured → assume caller is silent / line dropped. Wrap up.
  if (!utterance) {
    return xml(
      `<Response>` +
        `<Say voice="Polly.Amy-Neural">${escapeXml(timeoutLine())}</Say>` +
        `<Redirect method="POST">${escapeXml(`${publicBase}/api/twilio/voice/complete/${callSid}?reason=no_input`)}</Redirect>` +
      `</Response>`,
    );
  }

  const existing: Turn[] = Array.isArray(call.turns) ? (call.turns as Turn[]) : [];

  let result;
  try {
    result = await paTurn({
      turns: existing,
      callerUtterance: utterance,
      callerE164: call.from_e164,
    });
  } catch (e) {
    console.error("[pa-voice] paTurn failed:", e);
    // On Claude failure, be polite and close gracefully so we still capture
    // the transcript so far.
    return xml(
      `<Response>` +
        `<Say voice="Polly.Amy-Neural">Sorry, I'm having trouble. I'll let him know you called. Goodbye.</Say>` +
        `<Redirect method="POST">${escapeXml(`${publicBase}/api/twilio/voice/complete/${callSid}?reason=error`)}</Redirect>` +
      `</Response>`,
    );
  }

  const now = new Date().toISOString();
  const updatedTurns: Turn[] = [
    ...existing,
    { role: "caller", text: utterance, at: now },
    { role: "agent", text: result.say, at: now },
  ];

  const updatePatch: Record<string, unknown> = { turns: updatedTurns };
  if (result.action === "hangup" && result.done) {
    updatePatch.caller_name = result.done.caller_name ?? null;
    updatePatch.purpose = result.done.purpose ?? null;
    updatePatch.urgency = result.done.urgency ?? null;
    updatePatch.summary = result.done.summary ?? null;
  }
  await admin.from("voice_calls").update(updatePatch).eq("id", call.id);

  if (result.action === "hangup") {
    return xml(
      `<Response>` +
        `<Say voice="Polly.Amy-Neural">${escapeXml(result.say)}</Say>` +
        `<Redirect method="POST">${escapeXml(`${publicBase}/api/twilio/voice/complete/${callSid}?reason=hangup`)}</Redirect>` +
      `</Response>`,
    );
  }

  const nextTurnUrl = `${publicBase}/api/twilio/voice/turn/${callSid}`;
  // Low-confidence STT on short utterances is common; we still pass it to
  // Claude — which handles "sorry what?" gracefully — so we don't branch here.
  void confidence;

  return xml(
    `<Response>` +
      `<Say voice="Polly.Amy-Neural">${escapeXml(result.say)}</Say>` +
      `<Gather input="speech" action="${escapeXml(nextTurnUrl)}" method="POST"` +
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
