import { z } from "zod";
import { defineTool } from "./types";
import { executeOrQueueClientAction } from "./client-action";

/**
 * macOS-only tools. By default they return a "queued" stub so the live
 * desktop client can intercept the tool_use event and execute via Tauri.
 * When `ctx.queueClientAction` is wired (non-interactive contexts like
 * WhatsApp), the helper inserts a pending_client_actions row and blocks
 * on the desktop completing it, so the brain can see the real result.
 */

export const imessageReadTool = defineTool({
  name: "imessage_read",
  description:
    "Read recent iMessage / SMS conversations from the user's Mac. Returns CSV rows of timestamp, sender, text. Pass `contact` (phone like '+447xxx' or email) to filter to one chat. Requires Full Disk Access permission for the JARVIS desktop app.",
  schema: z.object({
    contact: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      contact: {
        type: "string",
        description:
          "Optional phone number or email of the contact to filter to. If omitted, returns the most recent messages across all chats.",
      },
      limit: { type: "number", description: "Max rows, 1–100. Default 20." },
    },
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "imessage_read", input, { expectsFollowup: true });
  },
});

export const imessageSendTool = defineTool({
  name: "imessage_send",
  description:
    "Send an iMessage to a contact via Messages.app. CONFIRM with the user before calling — sending a text is destructive. `to` must be a phone number (E.164 like '+447xxx') or email. Pair with contacts_lookup first to resolve a name.",
  schema: z.object({ to: z.string().min(1), text: z.string().min(1) }),
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Phone (+447xxx) or Apple ID email." },
      text: { type: "string", description: "Message body." },
    },
    required: ["to", "text"],
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "imessage_send", input);
  },
});

export const contactsLookupTool = defineTool({
  name: "contacts_lookup",
  description:
    "Look up a contact in the macOS Contacts app by name. Returns matching contacts with their phone numbers and emails. Use this to resolve 'text Maya' → her phone number before calling imessage_send.",
  schema: z.object({ query: z.string().min(1) }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name fragment to search (e.g. 'Maya', 'Smith')." },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "contacts_lookup", input, { expectsFollowup: true });
  },
});

export const notesReadTool = defineTool({
  name: "notes_read",
  description:
    "Read notes from the macOS Notes app. Pass `query` to search note titles + bodies. Returns the matching notes with their content.",
  schema: z.object({
    query: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional search term." },
      limit: { type: "number", description: "Max notes returned, 1–100. Default 20." },
    },
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "notes_read", input, { expectsFollowup: true });
  },
});

export const notesCreateTool = defineTool({
  name: "notes_create",
  description:
    "Create a new note in the macOS Notes app. Use for 'add a note', 'save this', 'remind me to write down X'.",
  schema: z.object({ title: z.string().min(1), body: z.string().optional() }),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title." },
      body: { type: "string", description: "Optional note body. Plain text or HTML." },
    },
    required: ["title"],
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "notes_create", input);
  },
});

export const musicPlayTool = defineTool({
  name: "music_play",
  description:
    "Play a song/artist from the user's Apple Music library (NOT Spotify — use play_spotify for Spotify). Searches local library by track name or artist. For streaming Apple Music search, use a Shortcut via run_shortcut.",
  schema: z.object({ query: z.string().min(1) }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Track name or artist substring." },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "music_play", input);
  },
});

export const musicControlTool = defineTool({
  name: "music_control",
  description:
    "Control Apple Music playback (NOT Spotify — use control_spotify for Spotify). Actions: play/pause/toggle/next/previous/volume/shuffle_on/shuffle_off/now_playing.",
  schema: z.object({
    action: z.enum([
      "play",
      "pause",
      "toggle",
      "next",
      "previous",
      "volume",
      "shuffle_on",
      "shuffle_off",
      "now_playing",
    ]),
    value: z.string().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "play",
          "pause",
          "toggle",
          "next",
          "previous",
          "volume",
          "shuffle_on",
          "shuffle_off",
          "now_playing",
        ],
      },
      value: { type: "string", description: "Only for action='volume'. Number 0-100." },
    },
    required: ["action"],
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "music_control", input);
  },
});

export const obsidianSearchTool = defineTool({
  name: "obsidian_search",
  description:
    "Search the user's Obsidian vault for notes containing a query. Returns up to 10 matching files with their content. Requires OBSIDIAN_VAULT_PATH env var to point at the vault directory.",
  schema: z.object({ query: z.string().min(1) }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to search for in note bodies/titles." },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    return executeOrQueueClientAction(ctx, "obsidian_search", input, { expectsFollowup: true });
  },
});
