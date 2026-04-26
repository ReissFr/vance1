// ResendProvider — TransactionalProvider implementation backed by the
// Resend REST API. API keys are stored directly (no OAuth flow available
// from Resend) and rotate on user action only.

import type {
  TransactionalProvider,
  SendEmailInput,
  SendEmailResult,
} from "./provider";

const API = "https://api.resend.com";

export type ResendCredentials = {
  api_key?: string | null;
  default_from?: string | null;
  /** Verified domain, informational only. */
  domain?: string | null;
};

export type ResendProviderOptions = {
  credentials: ResendCredentials;
};

export class ResendProvider implements TransactionalProvider {
  readonly providerName = "resend";
  private readonly apiKey: string;
  private readonly defaultFrom: string | null;

  constructor(opts: ResendProviderOptions) {
    const key = opts.credentials.api_key;
    if (!key) throw new Error("ResendProvider: no api_key in credentials");
    this.apiKey = key;
    this.defaultFrom = opts.credentials.default_from ?? null;
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const from = input.from ?? this.defaultFrom;
    if (!from) {
      throw new Error(
        "ResendProvider.sendEmail: no `from` given and no default_from configured on integration",
      );
    }

    const body: Record<string, unknown> = {
      from,
      to: splitList(input.to),
      subject: input.subject,
    };
    if (input.html) body.html = input.html;
    if (input.text) body.text = input.text;
    if (!input.html && !input.text) body.text = "";
    if (input.reply_to) body.reply_to = splitList(input.reply_to);
    if (input.cc) body.cc = splitList(input.cc);
    if (input.bcc) body.bcc = splitList(input.bcc);

    const res = await fetch(`${API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend send ${res.status}: ${text}`);
    }

    const json = (await res.json()) as { id: string };
    return { id: json.id, provider: "resend" };
  }
}

function splitList(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
