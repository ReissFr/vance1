// Inbound SMS / WhatsApp webhook. Twilio POSTs form-encoded here when someone
// texts our number or messages the WhatsApp sandbox. We log the message to
// inbound_messages; for WhatsApp we also run the brain and send a reply back.
//
// Also dispatches the inbound_message automation trigger so watcher-style rules
// (photo inbox, group-chat mode, keyword alerts) fire on incoming texts. If a
// matching rule has trigger_spec.swallow=true, we skip the conversational
// brain reply — the rule has already handled the message.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendWhatsApp, twilioEnv, verifyTwilioSignature } from "@/lib/twilio";
import { runBrainForMessage } from "@/lib/brain-run";
import { dispatchTrigger } from "@/lib/automation-engine";

export const runtime = "nodejs";

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

  const rawFrom = params.From ?? "";
  const body = params.Body ?? "";
  const sid = params.MessageSid ?? "";
  if (!rawFrom) return emptyTwiml();

  const isWhatsApp = rawFrom.startsWith("whatsapp:");
  const from = isWhatsApp ? rawFrom.slice("whatsapp:".length) : rawFrom;
  const channel = isWhatsApp ? "whatsapp" : "sms";

  // Twilio packs media as MediaUrl0..N with matching MediaContentType0..N.
  const numMedia = Number(params.NumMedia ?? "0") || 0;
  const mediaUrls: string[] = [];
  let mediaType: string | undefined;
  for (let i = 0; i < numMedia; i += 1) {
    const url = params[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
    if (i === 0) mediaType = params[`MediaContentType${i}`] || undefined;
  }

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("mobile_e164", from)
    .single();

  if (!profile?.id) {
    console.warn("[twilio/sms] no user matched for", from);
    return emptyTwiml();
  }

  await admin.from("inbound_messages").insert({
    user_id: profile.id,
    channel,
    from_e164: from,
    body,
    provider_sid: sid,
    ...(mediaUrls.length > 0 ? { media_urls: mediaUrls } : {}),
    ...(mediaType ? { media_type: mediaType } : {}),
  });

  // Fire the inbound_message trigger so watcher rules (photo inbox, group-chat
  // forwarding, keyword alerts) match before we decide whether to run the
  // brain conversationally. Done synchronously so we can honour swallow=true.
  let swallowed = false;
  try {
    const result = await dispatchTrigger(admin, "inbound_message", profile.id, {
      body,
      from,
      channel,
      media_urls: mediaUrls,
    });
    swallowed = result.swallowed;
  } catch (e) {
    console.error("[twilio/sms] dispatchTrigger failed:", e);
  }

  // Fire-and-forget brain run for WhatsApp. Twilio requires a <15s webhook
  // response, and brain runs are often longer, so we ack immediately and
  // send the reply as a separate outbound message when ready.
  if (isWhatsApp && body.trim() && !swallowed) {
    void handleWhatsAppInbound(profile.id, from, body).catch((e) =>
      console.error("[twilio/sms] WhatsApp handler failed:", e),
    );
  }

  return emptyTwiml();
}

async function handleWhatsAppInbound(userId: string, toE164: string, message: string): Promise<void> {
  const admin = supabaseAdmin();
  let replyText = "";
  try {
    const { text } = await runBrainForMessage({
      admin,
      userId,
      message,
      deviceKind: "mac",
      followupChannel: "whatsapp",
      followupToE164: toE164,
    });
    replyText = text.trim();
  } catch (e) {
    console.error("[twilio/sms] brain run failed:", e);
    replyText = "Sorry — I hit an error working on that. Try again, or check the logs.";
  }
  if (!replyText) return;
  try {
    const env = twilioEnv();
    await sendWhatsApp(env, toE164, replyText);
  } catch (e) {
    console.error("[twilio/sms] sendWhatsApp failed:", e);
  }
}

function publicUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
  return req.nextUrl.toString();
}

function emptyTwiml(): NextResponse {
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}
