// User-triggered endpoint to start an outbound PA call. Writes an
// outbound_calls row, then asks Twilio to place the call — Twilio will fetch
// our TwiML route, which hands the call to ConversationRelay and our WS
// server takes over from there.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { isValidE164, twilioEnv, TwilioNotConfiguredError } from "@/lib/twilio";

export const runtime = "nodejs";

type StartBody = {
  to_e164?: string;
  goal?: string;
  constraints?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const to = (body.to_e164 ?? "").trim();
  const goal = (body.goal ?? "").trim();
  const constraints = body.constraints ?? {};

  if (!isValidE164(to)) {
    return NextResponse.json({ ok: false, error: "to_e164 must be E.164 (+<country><number>)" }, { status: 400 });
  }
  if (!goal) {
    return NextResponse.json({ ok: false, error: "goal required" }, { status: 400 });
  }

  let env;
  try {
    env = twilioEnv();
  } catch (e) {
    const msg = e instanceof TwilioNotConfiguredError ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  if (!process.env.CONVERSATION_RELAY_WS_URL) {
    return NextResponse.json(
      { ok: false, error: "CONVERSATION_RELAY_WS_URL not configured" },
      { status: 500 },
    );
  }

  const admin = supabaseAdmin();
  const { data: row, error: insertErr } = await admin
    .from("outbound_calls")
    .insert({
      user_id: user.id,
      to_e164: to,
      goal,
      constraints,
      status: "queued",
    })
    .select("id")
    .single();
  if (insertErr || !row) {
    return NextResponse.json({ ok: false, error: insertErr?.message ?? "insert failed" }, { status: 500 });
  }

  // Ask Twilio to dial.
  const base = env.publicBaseUrl.replace(/\/+$/, "");
  const twimlUrl = `${base}/api/twilio/outbound/twiml/${row.id}`;
  const statusCallback = `${base}/api/twilio/outbound/status/${row.id}`;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        authorization:
          "Basic " + Buffer.from(`${env.accountSid}:${env.authToken}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: env.fromNumber,
        Url: twimlUrl,
        Method: "POST",
        StatusCallback: statusCallback,
        StatusCallbackEvent: "completed",
        StatusCallbackMethod: "POST",
      }),
    },
  );
  const data = (await res.json()) as { sid?: string; message?: string; status?: string };
  if (!res.ok) {
    await admin
      .from("outbound_calls")
      .update({
        status: "failed",
        error: `twilio ${res.status}: ${data.message ?? "error"}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return NextResponse.json(
      { ok: false, error: `twilio ${res.status}: ${data.message ?? "error"}` },
      { status: 502 },
    );
  }

  await admin
    .from("outbound_calls")
    .update({ status: "dialing", call_sid: data.sid ?? null })
    .eq("id", row.id);

  return NextResponse.json({ ok: true, id: row.id, call_sid: data.sid });
}
