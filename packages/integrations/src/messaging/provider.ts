// MessagingProvider — capability interface for team chat (Slack today;
// Discord/Teams pluggable). Destructive ops intentionally minimal — send,
// list, read — because these are the bread-and-butter workflows.

export interface MessagingProvider {
  readonly providerName: string;

  /** List channels the bot has been added to. */
  listChannels(input?: ListChannelsInput): Promise<Channel[]>;

  /** Post a message to a channel (by id or #name). */
  sendMessage(input: SendMessageInput): Promise<SendResult>;

  /** Read recent messages from a channel. */
  readChannel(input: ReadChannelInput): Promise<Message[]>;

  /** DM a user (resolves "@handle" or user id). */
  sendDirectMessage(input: SendDmInput): Promise<SendResult>;

  /** List workspace users (for DM targeting). */
  listUsers(limit?: number): Promise<MessagingUser[]>;

  /** Search messages across channels the bot can see. */
  searchMessages(input: SearchMessagesInput): Promise<Message[]>;
}

export type Channel = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  topic: string;
  purpose: string;
  member_count: number | null;
};

export type MessagingUser = {
  id: string;
  handle: string;
  real_name: string;
  email: string | null;
  is_bot: boolean;
  is_admin: boolean;
};

export type Message = {
  id: string; // slack ts
  channel_id: string;
  user: string | null;
  user_handle: string | null;
  text: string;
  timestamp: string; // slack ts in seconds (float-as-string)
  permalink: string | null;
};

export type ListChannelsInput = {
  types?: ("public_channel" | "private_channel" | "im" | "mpim")[];
  limit?: number;
};

export type SendMessageInput = {
  channel: string; // channel id, #name, or @handle
  text: string;
  thread_ts?: string; // reply in thread
};

export type SendDmInput = {
  user: string; // user id, @handle, or email
  text: string;
};

export type ReadChannelInput = {
  channel: string;
  limit?: number;
  oldest_ts?: string;
};

export type SearchMessagesInput = {
  query: string;
  limit?: number;
};

export type SendResult = {
  id: string; // message ts
  channel_id: string;
  permalink: string | null;
};
