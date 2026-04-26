// EmailProvider — capability interface for any user inbox backend.
//
// Intentionally narrow: every method here must be implementable on Gmail,
// Outlook/Graph, and IMAP+SMTP. Provider-specific extras (labels, categories,
// etc.) don't belong here — put them on the concrete class and don't lean on
// them from shared runners.

export type EmailListQuery = {
  // Free-form search string. Providers interpret it in their native query
  // language (Gmail: `is:unread newer_than:1d`; IMAP: folder/flags; etc.).
  // Runners that want provider-agnostic filtering should pass undefined and
  // rely on each provider's default "recent unread" behavior.
  query?: string;
  max: number;
};

export type EmailSummary = {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  message_id_header: string;
  snippet: string;
  body: string;
};

export type DraftResult = {
  id: string;
  open_url: string;
};

export interface EmailProvider {
  readonly providerName: string;

  list(query: EmailListQuery): Promise<EmailSummary[]>;

  createDraft(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<DraftResult>;

  // Creates a draft threaded to an existing message. Providers that can't
  // thread (e.g. plain SMTP with no IMAP indexing) should still create a
  // draft and silently ignore the thread metadata.
  createReplyDraft(input: {
    to: string;
    subject: string;
    body: string;
    threadId: string;
    inReplyTo: string;
  }): Promise<DraftResult>;
}
