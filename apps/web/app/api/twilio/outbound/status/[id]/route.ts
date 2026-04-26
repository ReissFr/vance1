// Twilio hits this when the outbound call finishes (CallStatus=completed,
// no-answer, failed, busy, canceled). We finalise the outbound_calls row
// and WhatsApp the owner with whatever outcome Claude extracted — or a
// "couldn't get through" note if the call never connected.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifyTwilioSignature } from "@/lib/twilio";
import { dispatchNotification } from "@/lib/notify";

export const runtime = "nodejs";

type Outcome = {
  success?: boolean;
  summary?: string;
  details?: Record<string, unknown>;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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

  const callStatus = String(form?.get("CallStatus") ?? "");
  const callSid = String(form?.get("CallSid") ?? "");

  const admin = supabaseAdmin();
  const { data: call } = await admin
    .from("outbound_calls")
    .select("id, user_id, to_e164, goal, status, outcome, turns")
    .eq("id", id)
    .single();

  if (!call) {
    return NextResponse.json({ ok: true, note: "unknown call" });
  }

  if (call.status === "completed" || call.status === "failed" || call.status === "no_answer") {
    return NextResponse.json({ ok: true, note: "already finalised" });
  }

  const dbStatus =
    callStatus === "completed"
      ? "completed"
      : callStatus === "no-answer" || callStatus === "busy"
        ? "no_answer"
        : "failed";

  const finalPatch: Record<string, unknown> = {
    status: dbStatus,
    completed_at: new Date().toISOString(),
  };
  if (callSid) finalPatch.call_sid = callSid;
  await admin.from("outbound_calls").update(finalPatch).eq("id", id);

  // Notify the owner.
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", call.user_id)
    .single();

  if (profile?.mobile_e164) {
    const body = buildSummary({
      to_e164: call.to_e164,
      goal: call.goal,
      status: dbStatus,
      outcome: (call.outcome as Outcome | null) ?? null,
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
        console.warn("[outbound/status] dispatchNotification failed:", e);
      });
    }
  }

  return NextResponse.json({ ok: true });
}

function buildSummary(opts: {
  to_e164: string;
  goal: string;
  status: "completed" | "no_answer" | "failed";
  outcome: Outcome | null;
}): string {
  if (opts.status === "no_answer") {
    return `📞 Called ${opts.to_e164} — no answer. Goal was: ${opts.goal.slice(0, 120)}`;
  }
  if (opts.status === "failed") {
    return `📞 Call to ${opts.to_e164} failed. Goal was: ${opts.goal.slice(0, 120)}`;
  }
  const icon = opts.outcome?.success ? "✅" : "⚠️";
  const summary = opts.outcome?.summary ?? "Call completed — no outcome recorded.";
  return `${icon} Called ${opts.to_e164}\nGoal: ${opts.goal.slice(0, 120)}\n${summary}`;
}

function publicUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
  return req.nextUrl.toString();
}
