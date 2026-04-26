// Twilio calls this URL when our outbound call connects. We respond with
// TwiML that hands the call off to Twilio ConversationRelay, pointing at our
// WebSocket server. Twilio will stream transcribed speech into the WS and
// speak back whatever text we reply with.
//
// The [id] segment is the outbound_calls.id — the WS server uses it to load
// the goal + transcript.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(req, await params);
}
// Twilio fetches via GET when the Calls API is given Method=GET.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(req, await params);
}

async function handle(_req: NextRequest, { id }: { id: string }) {
  const admin = supabaseAdmin();
  const { data: call } = await admin
    .from("outbound_calls")
    .select("id, status")
    .eq("id", id)
    .single();

  if (!call) {
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">No active call. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  // wss URL of our WebSocket server. Must be ws/wss and publicly reachable —
  // same ngrok tunnel, different subpath/port depending on how you expose it.
  // CONVERSATION_RELAY_WS_URL should look like "wss://<your ngrok>/relay".
  const wsUrl = process.env.CONVERSATION_RELAY_WS_URL;
  if (!wsUrl) {
    console.error("[outbound/twiml] CONVERSATION_RELAY_WS_URL not set");
    return xml(
      `<Response><Say voice="Polly.Matthew-Neural">Configuration error. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  // The WS URL can carry the call_id as a query param so the WS handler knows
  // which row to load.
  const url = `${wsUrl}${wsUrl.includes("?") ? "&" : "?"}call_id=${encodeURIComponent(id)}`;

  // ConversationRelay handles STT + TTS + VAD. We set a British voice and
  // pick a language that matches what we'll be speaking.
  // ConversationRelay uses its own voice/language naming which differs from
  // <Say>. We let it default to avoid "TTS provider rejected the request".
  // Revisit once we know a known-good Amazon Polly voice ID for CR.
  return xml(
    `<Response>` +
      `<Connect>` +
        `<ConversationRelay url="${escapeAttr(url)}"/>` +
      `</Connect>` +
    `</Response>`,
  );
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xml(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}
