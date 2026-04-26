// GmailProvider — EmailProvider implementation backed by the Gmail REST API
// via the `googleapis` SDK.
//
// Handles OAuth access-token refresh internally: if the stored token is
// expired (or within SKEW_MS of expiry), the provider refreshes it using the
// stored refresh_token and calls the persist() callback so the resolver can
// write the new token back to the integrations row.

import { google } from "googleapis";
import type {
  EmailProvider,
  EmailListQuery,
  EmailSummary,
  DraftResult,
} from "./provider";

const SKEW_MS = 60_000;

export type GmailCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
};

export type GmailPersistFn = (updated: {
  credentials: GmailCredentials;
  expires_at: string;
}) => Promise<void>;

export type GmailProviderOptions = {
  credentials: GmailCredentials;
  expiresAt: string | null;
  persist: GmailPersistFn;
  clientId: string;
  clientSecret: string;
};

export class GmailProvider implements EmailProvider {
  readonly providerName = "gmail";

  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: string | null;
  private readonly persist: GmailPersistFn;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(opts: GmailProviderOptions) {
    this.accessToken = opts.credentials.access_token ?? null;
    this.refreshToken = opts.credentials.refresh_token ?? null;
    this.expiresAt = opts.expiresAt;
    this.persist = opts.persist;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
  }

  async list(query: EmailListQuery): Promise<EmailSummary[]> {
    const gmail = await this.client();
    const list = await gmail.users.messages.list({
      userId: "me",
      q: query.query ?? "is:unread newer_than:1d",
      maxResults: query.max,
    });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    if (ids.length === 0) return [];

    const details = await Promise.all(
      ids.map((id) => gmail.users.messages.get({ userId: "me", id, format: "full" })),
    );

    return details.map((d) => {
      const headers = d.data.payload?.headers ?? [];
      const h = (name: string) =>
        headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
      return {
        id: d.data.id ?? "",
        thread_id: d.data.threadId ?? "",
        from: h("From"),
        to: h("To"),
        subject: h("Subject"),
        date: h("Date"),
        message_id_header: h("Message-ID") || h("Message-Id"),
        snippet: d.data.snippet ?? "",
        body: extractBody(d.data.payload),
      };
    });
  }

  async createDraft(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<DraftResult> {
    const gmail = await this.client();
    const raw = Buffer.from(
      [
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        "Content-Type: text/plain; charset=UTF-8",
        "",
        input.body,
      ].join("\r\n"),
    ).toString("base64url");
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw } },
    });
    return {
      id: res.data.id ?? "",
      open_url: "https://mail.google.com/mail/u/0/#drafts",
    };
  }

  async createReplyDraft(input: {
    to: string;
    subject: string;
    body: string;
    threadId: string;
    inReplyTo: string;
  }): Promise<DraftResult> {
    const gmail = await this.client();
    const headers = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "Content-Type: text/plain; charset=UTF-8",
    ];
    if (input.inReplyTo) {
      headers.push(`In-Reply-To: ${input.inReplyTo}`);
      headers.push(`References: ${input.inReplyTo}`);
    }
    const raw = Buffer.from([...headers, "", input.body].join("\r\n")).toString("base64url");
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, threadId: input.threadId || undefined } },
    });
    return {
      id: res.data.id ?? "",
      open_url: "https://mail.google.com/mail/u/0/#drafts",
    };
  }

  // Returns a Gmail API client using the current access token, refreshing
  // first if the token is expired or about to expire. Also handles the case
  // where the access_token is missing but a refresh_token is on file
  // (happens on first use after the server-side OAuth callback).
  private async client() {
    await this.ensureFreshAccessToken();
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: this.accessToken });
    return google.gmail({ version: "v1", auth });
  }

  private async ensureFreshAccessToken(): Promise<void> {
    const needsRefresh =
      !this.accessToken ||
      !this.expiresAt ||
      new Date(this.expiresAt).getTime() - Date.now() < SKEW_MS;
    if (!needsRefresh && this.accessToken) return;

    if (!this.refreshToken) {
      throw new Error(
        "Gmail access token expired and no refresh token on file — reconnect Google account",
      );
    }

    const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret);
    oauth2.setCredentials({ refresh_token: this.refreshToken });
    const res = await oauth2.refreshAccessToken();
    const newAccess = res.credentials.access_token;
    if (!newAccess) throw new Error("Google refresh returned no access token");
    const newExpiryMs = res.credentials.expiry_date ?? Date.now() + 3500_000;

    this.accessToken = newAccess;
    this.expiresAt = new Date(newExpiryMs).toISOString();

    await this.persist({
      credentials: {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
      },
      expires_at: this.expiresAt,
    });
  }
}

function extractBody(payload: unknown): string {
  const p = payload as
    | { mimeType?: string; body?: { data?: string }; parts?: unknown[] }
    | undefined;
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
