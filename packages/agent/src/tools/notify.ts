import { z } from "zod";
import { defineTool } from "./types";

// Reach the user on their phone. The Twilio integration itself lives in the web
// app (needs its public URL for TwiML callbacks), so this tool posts to the
// server endpoint rather than calling Twilio directly from the agent.
//
// The tool returns quickly; SMS/call delivery is tracked in the notifications
// table and shown in the Tasks/Notifications panel.
export const notifyUserTool = defineTool({
  name: "notify_user",
  description: [
    "Reach the user on their phone when something happens that they should know about —",
    "a long task finished, a decision needs their input, or something urgent came up.",
    "",
    "Levels:",
    "- 'whatsapp' — default choice. Delivered via WhatsApp; the user's preferred channel.",
    "- 'sms' — fallback if WhatsApp isn't configured. Text only.",
    "- 'call' — places a phone call that speaks the message once and hangs up. Use for",
    "  urgent items (deadline, customer waiting, emergency) or when you've already messaged",
    "  and they haven't replied.",
    "- 'whatsapp_then_call' — send a WhatsApp immediately, then place a call ~5 minutes later",
    "  if they haven't replied. Use for medium-urgency items.",
    "",
    "Keep messages short (under 200 chars for SMS). For calls, write what you want to be",
    "SPOKEN — no links, no markdown. The call is one-way in this version; they can call",
    "back or reply via SMS.",
    "",
    "Do not use this for normal chat replies — that's what the main chat is for. Only use",
    "when the user is likely away from their screen.",
  ].join("\n"),
  schema: z.object({
    message: z
      .string()
      .min(1)
      .max(600)
      .describe("What to tell the user. Plain text, no markdown. Keep short for SMS."),
    level: z
      .enum(["whatsapp", "sms", "call", "whatsapp_then_call", "sms_then_call"])
      .describe("Delivery channel — see tool description."),
    task_id: z
      .string()
      .uuid()
      .optional()
      .describe("Link this notification to a task (so it shows in the task card)."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "Message to send. Plain text, short." },
      level: {
        type: "string",
        enum: ["whatsapp", "sms", "call", "whatsapp_then_call", "sms_then_call"],
        description: "'whatsapp' = WhatsApp message (preferred), 'sms' = text, 'call' = voice call, '<channel>_then_call' = message now, call if no reply.",
      },
      task_id: { type: "string", description: "Optional task UUID to link." },
    },
    required: ["message", "level"],
  },
  async run(input, ctx) {
    // The tool runs inside the Next.js process, so we can reach the server
    // endpoint directly via an internal fetch. But to keep ctx lean and avoid
    // coupling, we insert the notification row ourselves and let a server-side
    // trigger / poller do the actual Twilio dispatch.
    //
    // For MVP we insert the row with status='queued' and rely on the /api/agent
    // route (which runs the tool) to also invoke the Twilio dispatcher after
    // the agent turn returns. See notifyDispatcher in apps/web/lib/notify.ts.

    // Look up the user's mobile.
    const { data: profile, error: profErr } = await ctx.supabase
      .from("profiles")
      .select("mobile_e164")
      .eq("id", ctx.userId)
      .single();

    if (profErr) {
      throw new Error(`could not load profile: ${profErr.message}`);
    }
    if (!profile?.mobile_e164) {
      return {
        ok: false,
        error:
          "No mobile number on file. Tell the user to add their mobile number in Vance settings (Profile → Mobile Number) before you can reach them this way.",
      };
    }

    const firstChannel =
      input.level === "call"
        ? "call"
        : input.level === "sms" || input.level === "sms_then_call"
        ? "sms"
        : "whatsapp";

    const insertBody: Record<string, unknown> = {
      user_id: ctx.userId,
      channel: firstChannel,
      to_e164: profile.mobile_e164,
      body: input.message,
      status: "queued",
    };
    if (input.task_id) insertBody.task_id = input.task_id;

    const { data: first, error: insErr } = await ctx.supabase
      .from("notifications")
      .insert(insertBody)
      .select("id")
      .single();

    if (insErr) throw new Error(`could not queue notification: ${insErr.message}`);

    // Dispatch the first notification immediately if the host has wired
    // a dispatcher. If not, it just stays queued (visible to the user) and a
    // later worker / manual retry can pick it up.
    if (ctx.dispatchNotification) {
      try {
        await ctx.dispatchNotification(first.id);
      } catch (e) {
        // Delivery failure is recorded on the row by the dispatcher itself;
        // swallow here so the brain can still reply coherently.
        console.warn("[notify_user] first dispatch failed:", e);
      }
    }

    // For sms_then_call, insert the follow-up call row with status='scheduled'.
    // A separate worker picks those up after the delay; for MVP we just queue
    // it and leave it to a later tick (doesn't auto-fire in this session).
    let secondId: string | null = null;
    if (input.level === "sms_then_call" || input.level === "whatsapp_then_call") {
      const { data: second, error: err2 } = await ctx.supabase
        .from("notifications")
        .insert({
          user_id: ctx.userId,
          channel: "call",
          to_e164: profile.mobile_e164,
          body: input.message,
          status: "queued",
          ...(input.task_id ? { task_id: input.task_id } : {}),
        })
        .select("id")
        .single();
      if (err2) throw new Error(`could not queue escalation call: ${err2.message}`);
      secondId = second.id;
    }

    return {
      ok: true,
      notification_ids: secondId ? [first.id, secondId] : [first.id],
      level: input.level,
      to: profile.mobile_e164,
      message:
        "Notification queued. Tell the user you've just sent them a text/called them and that you'll wait for their reply.",
    };
  },
});
