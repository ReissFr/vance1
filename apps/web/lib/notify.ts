// Server-side notification dispatcher. Reads a queued notification row,
// sends it via Twilio, writes sid + status back to the row.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, sendWhatsApp, startCall, twilioEnv, TwilioNotConfiguredError } from "./twilio";

export async function dispatchNotification(
  supabaseAdmin: SupabaseClient,
  notificationId: string,
): Promise<void> {
  const { data: n, error } = await supabaseAdmin
    .from("notifications")
    .select("id, user_id, channel, to_e164, body, status")
    .eq("id", notificationId)
    .single();
  if (error || !n) throw new Error(`notification not found: ${error?.message ?? "no row"}`);
  if (n.status !== "queued") return; // idempotent

  let env;
  try {
    env = twilioEnv();
  } catch (e) {
    const msg = e instanceof TwilioNotConfiguredError ? e.message : String(e);
    await supabaseAdmin
      .from("notifications")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", notificationId);
    return;
  }

  try {
    if (n.channel === "sms") {
      const res = await sendSms(env, n.to_e164, n.body);
      await supabaseAdmin
        .from("notifications")
        .update({ status: res.status === "failed" ? "failed" : "sent", provider_sid: res.sid })
        .eq("id", notificationId);
    } else if (n.channel === "whatsapp") {
      const res = await sendWhatsApp(env, n.to_e164, n.body);
      await supabaseAdmin
        .from("notifications")
        .update({ status: res.status === "failed" ? "failed" : "sent", provider_sid: res.sid })
        .eq("id", notificationId);
    } else if (n.channel === "call") {
      const res = await startCall(env, n.to_e164, n.id);
      await supabaseAdmin
        .from("notifications")
        .update({ status: "in_progress", provider_sid: res.sid })
        .eq("id", notificationId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("notifications")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", notificationId);
  }
}
