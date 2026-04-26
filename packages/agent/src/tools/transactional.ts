// Brain tool for transactional email (Resend). Separate from the Gmail
// draft-email tool: this sends immediately from a verified sender (the
// user's domain), not Reiss's personal Gmail.

import { z } from "zod";
import { getTransactionalProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const PROVIDERS = ["resend"] as const;

export const sendTransactionalEmailTool = defineTool({
  name: "send_transactional_email",
  description:
    "Send an email through the user's transactional-email provider (e.g. Resend) from a verified domain. Use this for system notifications, confirmations, receipts, programmatic replies. NOT for drafting a personal reply from the user's Gmail — that's draft_email. Destructive-ish: the email goes out immediately.",
  schema: z.object({
    to: z.string().min(1),
    subject: z.string().min(1),
    text: z.string().optional(),
    html: z.string().optional(),
    from: z.string().optional().describe("Override default-from. Must be verified."),
    reply_to: z.string().optional(),
    cc: z.string().optional(),
    bcc: z.string().optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient. Comma-separated for multiple." },
      subject: { type: "string" },
      text: { type: "string" },
      html: { type: "string" },
      from: { type: "string" },
      reply_to: { type: "string" },
      cc: { type: "string" },
      bcc: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["to", "subject"],
  },
  async run(input, ctx) {
    const tx = await getTransactionalProvider(ctx.supabase, ctx.userId, input.provider);
    const result = await tx.sendEmail({
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      from: input.from,
      reply_to: input.reply_to,
      cc: input.cc,
      bcc: input.bcc,
    });
    return { ok: true, ...result };
  },
});
