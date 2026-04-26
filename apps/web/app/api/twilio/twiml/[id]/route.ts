// TwiML endpoint Twilio hits when our outbound call connects. Returns XML that
// tells Twilio what to say / play, then hang up.
//
// Flow: our lib/twilio.ts startCall() passes Url=/api/twilio/twiml/{notificationId}
// with Method=GET. Twilio fetches this URL, speaks the body, hangs up.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { escapeXml, verifyTwilioSignature } from "@/lib/twilio";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(req, await params);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(req, await params);
}

async function handle(req: NextRequest, { id }: { id: string }) {
  // Verify Twilio signature when auth token is set.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const sig = req.headers.get("x-twilio-signature");
    const url = publicUrl(req);
    const paramsForSig: Record<string, string> = {};
    if (req.method === "POST") {
      const form = await req.formData().catch(() => null);
      if (form) for (const [k, v] of form.entries()) paramsForSig[k] = String(v);
    }
    if (!verifyTwilioSignature(authToken, url, paramsForSig, sig)) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }

  const admin = supabaseAdmin();
  const { data: n } = await admin
    .from("notifications")
    .select("id, user_id, body, channel, task_id")
    .eq("id", id)
    .single();

  if (!n || n.channel !== "call") {
    return xml(`<Response><Say>Sorry, this message is no longer available.</Say><Hangup/></Response>`);
  }

  const publicBase = (
    process.env.TWILIO_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ""
  ).replace(/\/+$/, "");

  // Interactive approval calls (task_id present) use Polly — ElevenLabs over
  // phone narrowband sounds mumbled and DTMF comprehension matters more than
  // voice personality. Informational one-way calls still use ElevenLabs for
  // the nicer voice.
  const elKey = process.env.ELEVENLABS_API_KEY;

  if (n.task_id && publicBase) {
    const gatherAction = `${publicBase}/api/twilio/gather/${n.id}`;
    const body = escapeXml(n.body);
    return xml(
      `<Response>` +
        `<Pause length="1"/>` +
        `<Gather numDigits="1" timeout="10" action="${escapeXml(gatherAction)}" method="POST">` +
          `<Say voice="Polly.Matthew-Neural">${body}</Say>` +
          `<Pause length="1"/>` +
          `<Say voice="Polly.Matthew-Neural">Press 1 to approve.</Say>` +
        `</Gather>` +
        `<Say voice="Polly.Matthew-Neural">No input received. Goodbye.</Say>` +
        `<Hangup/>` +
      `</Response>`,
    );
  }

  // One-way informational call.
  const speech =
    elKey && publicBase
      ? `<Play>${escapeXml(`${publicBase}/api/twilio/tts/${n.id}`)}</Play>`
      : `<Say voice="Polly.Matthew-Neural">${escapeXml(n.body)}</Say>`;
  return xml(`<Response>${speech}<Hangup/></Response>`);
}

function publicUrl(req: NextRequest): string {
  // Twilio signs the exact URL it called. Reconstruct it using the forwarded
  // host (Netlify sets these) so the signature check matches.
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
