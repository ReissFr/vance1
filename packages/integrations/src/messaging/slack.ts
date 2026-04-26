// SlackProvider — MessagingProvider backed by Slack Web API. Uses the
// bot_access_token granted via the OAuth v2 install flow. Slack bot tokens
// don't expire unless rotation is enabled on the app (we don't enable it).

import type {
  MessagingProvider,
  Channel,
  Message,
  MessagingUser,
  SendResult,
  ListChannelsInput,
  SendMessageInput,
  SendDmInput,
  ReadChannelInput,
  SearchMessagesInput,
} from "./provider";

const API = "https://slack.com/api";

export type SlackCredentials = {
  bot_token?: string | null;
  user_token?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  bot_user_id?: string | null;
  authed_user_id?: string | null;
};

export type SlackProviderOptions = {
  credentials: SlackCredentials;
};

export class SlackProvider implements MessagingProvider {
  readonly providerName = "slack";
  private readonly botToken: string;
  private readonly userToken: string | null;

  constructor(opts: SlackProviderOptions) {
    const token = opts.credentials.bot_token;
    if (!token) throw new Error("SlackProvider: no bot_token in credentials");
    this.botToken = token;
    this.userToken = opts.credentials.user_token ?? null;
  }

  async listChannels(input?: ListChannelsInput): Promise<Channel[]> {
    const res = await this.call("conversations.list", {
      types: (input?.types ?? ["public_channel", "private_channel"]).join(","),
      exclude_archived: true,
      limit: clamp(input?.limit ?? 100, 1, 1000),
    });
    const channels = ((res.channels as unknown[]) ?? []) as SlackChannel[];
    return channels.map(mapChannel);
  }

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    const channelId = await this.resolveChannelId(input.channel);
    const res = await this.call("chat.postMessage", {
      channel: channelId,
      text: input.text,
      thread_ts: input.thread_ts,
    });
    const ts = String(res.ts ?? "");
    const permalink = await this.permalink(channelId, ts);
    return { id: ts, channel_id: channelId, permalink };
  }

  async readChannel(input: ReadChannelInput): Promise<Message[]> {
    const channelId = await this.resolveChannelId(input.channel);
    const res = await this.call("conversations.history", {
      channel: channelId,
      limit: clamp(input.limit ?? 30, 1, 200),
      oldest: input.oldest_ts,
    });
    const messages = ((res.messages as unknown[]) ?? []) as SlackMessage[];
    const userCache = await this.cacheUsers(messages.map((m) => m.user).filter(Boolean) as string[]);
    return messages.map((m) => mapMessage(m, channelId, userCache));
  }

  async sendDirectMessage(input: SendDmInput): Promise<SendResult> {
    const userId = await this.resolveUserId(input.user);
    const open = await this.call("conversations.open", { users: userId });
    const channelId = (open.channel as { id?: string } | undefined)?.id;
    if (!channelId) throw new Error("SlackProvider.sendDirectMessage: no channel id returned");
    return this.sendMessage({ channel: channelId, text: input.text });
  }

  async listUsers(limit = 100): Promise<MessagingUser[]> {
    const res = await this.call("users.list", { limit: clamp(limit, 1, 1000) });
    const members = ((res.members as unknown[]) ?? []) as SlackUser[];
    return members
      .filter((u) => !u.deleted)
      .map((u) => ({
        id: u.id,
        handle: u.name ?? "",
        real_name: u.real_name ?? u.profile?.real_name ?? "",
        email: u.profile?.email ?? null,
        is_bot: Boolean(u.is_bot),
        is_admin: Boolean(u.is_admin),
      }));
  }

  async searchMessages(input: SearchMessagesInput): Promise<Message[]> {
    // search.messages requires a user token (not bot). If we don't have one,
    // fall back to an empty result rather than erroring.
    if (!this.userToken) return [];
    const res = await this.call(
      "search.messages",
      { query: input.query, count: clamp(input.limit ?? 20, 1, 100) },
      this.userToken,
    );
    const matches = (res.messages as { matches?: SlackSearchHit[] } | undefined)?.matches ?? [];
    return matches.map((m) => ({
      id: m.ts ?? "",
      channel_id: m.channel?.id ?? "",
      user: m.user ?? null,
      user_handle: m.username ?? null,
      text: m.text ?? "",
      timestamp: m.ts ?? "",
      permalink: m.permalink ?? null,
    }));
  }

  private async resolveChannelId(input: string): Promise<string> {
    // Already an id? Slack channel ids start with C, G, D.
    if (/^[CGD][A-Z0-9]{6,}$/.test(input)) return input;
    const name = input.startsWith("#") ? input.slice(1) : input;
    if (input.startsWith("@")) {
      // DM shorthand
      const userId = await this.resolveUserId(input);
      const open = await this.call("conversations.open", { users: userId });
      const id = (open.channel as { id?: string } | undefined)?.id;
      if (!id) throw new Error(`SlackProvider: couldn't open DM with ${input}`);
      return id;
    }
    const list = await this.listChannels({ limit: 1000 });
    const match = list.find((c) => c.name === name);
    if (!match) throw new Error(`SlackProvider: channel '${input}' not found`);
    return match.id;
  }

  private async resolveUserId(input: string): Promise<string> {
    if (/^U[A-Z0-9]{6,}$/.test(input)) return input;
    const handle = input.startsWith("@") ? input.slice(1) : input;
    if (handle.includes("@")) {
      // Looks like an email.
      const res = await this.call("users.lookupByEmail", { email: handle });
      const id = (res.user as { id?: string } | undefined)?.id;
      if (!id) throw new Error(`SlackProvider: no user with email ${handle}`);
      return id;
    }
    const users = await this.listUsers(1000);
    const match = users.find((u) => u.handle === handle);
    if (!match) throw new Error(`SlackProvider: user '${input}' not found`);
    return match.id;
  }

  private async cacheUsers(ids: string[]): Promise<Map<string, string>> {
    const cache = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return cache;
    // Rather than N info calls, fetch the full user list once.
    try {
      const users = await this.listUsers(1000);
      for (const u of users) cache.set(u.id, u.handle);
    } catch {
      // swallow — cache stays empty
    }
    return cache;
  }

  private async permalink(channel: string, ts: string): Promise<string | null> {
    try {
      const res = await this.call("chat.getPermalink", {
        channel,
        message_ts: ts,
      });
      return (res.permalink as string) ?? null;
    } catch {
      return null;
    }
  }

  private async call(
    method: string,
    params: Record<string, unknown>,
    tokenOverride?: string,
  ): Promise<Record<string, unknown>> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      body.set(k, typeof v === "boolean" ? (v ? "true" : "false") : String(v));
    }
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenOverride ?? this.botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Slack ${method} HTTP ${res.status}`);
    }
    const json = (await res.json()) as { ok: boolean; error?: string } & Record<
      string,
      unknown
    >;
    if (!json.ok) {
      throw new Error(`Slack ${method} failed: ${json.error ?? "unknown"}`);
    }
    return json;
  }
}

type SlackChannel = {
  id: string;
  name: string;
  is_private?: boolean;
  is_member?: boolean;
  topic?: { value?: string };
  purpose?: { value?: string };
  num_members?: number;
};

type SlackMessage = {
  ts?: string;
  user?: string | null;
  username?: string | null;
  text?: string;
};

type SlackUser = {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_admin?: boolean;
  profile?: { real_name?: string; email?: string };
};

type SlackSearchHit = {
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  permalink?: string;
  channel?: { id?: string };
};

function mapChannel(c: SlackChannel): Channel {
  return {
    id: c.id,
    name: c.name,
    is_private: Boolean(c.is_private),
    is_member: Boolean(c.is_member),
    topic: c.topic?.value ?? "",
    purpose: c.purpose?.value ?? "",
    member_count: c.num_members ?? null,
  };
}

function mapMessage(
  m: SlackMessage,
  channelId: string,
  handles: Map<string, string>,
): Message {
  return {
    id: m.ts ?? "",
    channel_id: channelId,
    user: m.user ?? null,
    user_handle: m.user ? handles.get(m.user) ?? null : m.username ?? null,
    text: m.text ?? "",
    timestamp: m.ts ?? "",
    permalink: null,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
