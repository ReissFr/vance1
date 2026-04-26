// TransactionalProvider — send-only email for JARVIS to dispatch system
// notifications, confirmations, or programmatic messages. Distinct from
// EmailProvider (which is a full read/write inbox) — this is one-way.

export interface TransactionalProvider {
  readonly providerName: string;

  /** Send a transactional email. Returns provider-specific message id. */
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

export type SendEmailInput = {
  /** Single recipient or comma-list. */
  to: string;
  /** Override default-from. Must be a verified sender at the provider. */
  from?: string;
  subject: string;
  /** Plain-text body. HTML is derived by wrapping in <p> unless html given. */
  text?: string;
  html?: string;
  reply_to?: string;
  cc?: string;
  bcc?: string;
};

export type SendEmailResult = {
  id: string;
  provider: string;
};
