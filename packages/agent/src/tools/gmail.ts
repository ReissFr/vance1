import { google } from "googleapis";
import { z } from "zod";
import { defineTool } from "./types";

function gmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

export const listEmailsTool = defineTool({
  name: "list_emails",
  description:
    "List recent emails matching a Gmail search query (e.g. 'is:unread', 'from:alex@example.com newer_than:7d'). Returns sender, subject, snippet, and id.",
  schema: z.object({
    query: z.string().optional(),
    max: z.number().int().min(1).max(25).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail search query. Defaults to 'is:unread'." },
      max: { type: "number", description: "Max results, 1–25. Default 10." },
    },
  },
  async run(input, ctx) {
    if (!ctx.googleAccessToken) throw new Error("Google account not connected");
    const gmail = gmailClient(ctx.googleAccessToken);
    const list = await gmail.users.messages.list({
      userId: "me",
      q: input.query ?? "is:unread",
      maxResults: input.max ?? 10,
    });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const details = await Promise.all(
      ids.map((id) =>
        gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        }),
      ),
    );
    return details.map((d) => {
      const h = (name: string) => d.data.payload?.headers?.find((x) => x.name === name)?.value ?? "";
      return {
        id: d.data.id,
        from: h("From"),
        subject: h("Subject"),
        date: h("Date"),
        snippet: d.data.snippet ?? "",
      };
    });
  },
});

export const readEmailTool = defineTool({
  name: "read_email",
  description: "Fetch the full body of a single email by id.",
  schema: z.object({ id: z.string() }),
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "Gmail message id." } },
    required: ["id"],
  },
  async run(input, ctx) {
    if (!ctx.googleAccessToken) throw new Error("Google account not connected");
    const gmail = gmailClient(ctx.googleAccessToken);
    const res = await gmail.users.messages.get({ userId: "me", id: input.id, format: "full" });
    const body = extractBody(res.data.payload);
    const h = (name: string) => res.data.payload?.headers?.find((x) => x.name === name)?.value ?? "";
    return {
      id: res.data.id,
      from: h("From"),
      to: h("To"),
      subject: h("Subject"),
      date: h("Date"),
      body: `<untrusted>${body}</untrusted>`,
    };
  },
});

function extractBody(payload: unknown): string {
  const p = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] } | undefined;
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) {
    return Buffer.from(p.body.data, "base64").toString("utf-8");
  }
  if (p.parts) {
    for (const part of p.parts) {
      const out = extractBody(part);
      if (out) return out;
    }
  }
  return "";
}

export const draftEmailTool = defineTool({
  name: "draft_email",
  description:
    "Create a DRAFT email (does not send). Use when the user wants to compose something but hasn't confirmed sending yet.",
  schema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
    reply_to_id: z.string().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string" },
      body: { type: "string", description: "Plain-text body." },
      reply_to_id: { type: "string", description: "Optional Gmail message id to thread as a reply." },
    },
    required: ["to", "subject", "body"],
  },
  async run(input, ctx) {
    if (!ctx.googleAccessToken) throw new Error("Google account not connected");
    const gmail = gmailClient(ctx.googleAccessToken);
    const raw = buildRaw(input.to, input.subject, input.body);
    const draft = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
    return { draft_id: draft.data.id, status: "created" };
  },
});

function buildRaw(to: string, subject: string, body: string): string {
  const msg = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset=UTF-8`, "", body].join("\r\n");
  return Buffer.from(msg).toString("base64url");
}
