// Brain-level Slack tools via the MessagingProvider resolver.

import { z } from "zod";
import { getMessagingProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const PROVIDERS = ["slack"] as const;

export const slackListChannelsTool = defineTool({
  name: "slack_list_channels",
  description:
    "List Slack channels the bot has been added to (public + private). Use before sending to unknown channels.",
  schema: z.object({
    limit: z.number().int().min(1).max(1000).optional(),
    include_private: z.boolean().optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max, 1–1000. Default 100." },
      include_private: { type: "boolean", description: "Include private channels. Default true." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const slack = await getMessagingProvider(ctx.supabase, ctx.userId, input.provider);
    const types: ("public_channel" | "private_channel")[] =
      input.include_private === false
        ? ["public_channel"]
        : ["public_channel", "private_channel"];
    return {
      provider: slack.providerName,
      channels: await slack.listChannels({ types, limit: input.limit }),
    };
  },
});

export const slackSendMessageTool = defineTool({
  name: "slack_send_message",
  description:
    "Post a message to a Slack channel. `channel` accepts a channel id (C…), a #name, or @handle for DMs. Use `thread_ts` to reply in a thread.",
  schema: z.object({
    channel: z.string().min(1),
    text: z.string().min(1),
    thread_ts: z.string().optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Channel id (C…), #name, or @handle for a DM.",
      },
      text: { type: "string" },
      thread_ts: { type: "string", description: "Parent message ts to reply in a thread." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["channel", "text"],
  },
  async run(input, ctx) {
    const slack = await getMessagingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: slack.providerName,
      result: await slack.sendMessage({
        channel: input.channel,
        text: input.text,
        thread_ts: input.thread_ts,
      }),
    };
  },
});

export const slackReadChannelTool = defineTool({
  name: "slack_read_channel",
  description:
    "Read recent messages from a Slack channel. Returns text, user handle, and timestamps — great for catching up on a conversation.",
  schema: z.object({
    channel: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Channel id or #name." },
      limit: { type: "number", description: "Max messages, 1–200. Default 30." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["channel"],
  },
  async run(input, ctx) {
    const slack = await getMessagingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: slack.providerName,
      messages: await slack.readChannel({
        channel: input.channel,
        limit: input.limit,
      }),
    };
  },
});

export const slackSendDmTool = defineTool({
  name: "slack_send_dm",
  description:
    "Send a direct message to a Slack user. `user` accepts a user id (U…), a @handle, or an email address.",
  schema: z.object({
    user: z.string().min(1),
    text: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      user: { type: "string", description: "user id, @handle, or email." },
      text: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["user", "text"],
  },
  async run(input, ctx) {
    const slack = await getMessagingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: slack.providerName,
      result: await slack.sendDirectMessage({ user: input.user, text: input.text }),
    };
  },
});

export const slackListUsersTool = defineTool({
  name: "slack_list_users",
  description:
    "List Slack workspace users. Use before DMing an unknown person to find their handle.",
  schema: z.object({
    limit: z.number().int().min(1).max(1000).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max, 1–1000. Default 100." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const slack = await getMessagingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: slack.providerName,
      users: await slack.listUsers(input.limit ?? 100),
    };
  },
});

export const slackSearchMessagesTool = defineTool({
  name: "slack_search_messages",
  description:
    "Search historical Slack messages by keyword. Requires the `search:read` user scope — returns empty if only the bot token was granted.",
  schema: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number", description: "Max, 1–100. Default 20." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    const slack = await getMessagingProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: slack.providerName,
      messages: await slack.searchMessages({
        query: input.query,
        limit: input.limit,
      }),
    };
  },
});
