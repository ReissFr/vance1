// Brain tools for FilesProvider (Google Drive today).

import { z } from "zod";
import { getFilesProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const PROVIDERS = ["google_drive"] as const;

export const filesSearchTool = defineTool({
  name: "files_search",
  description:
    "Search the user's cloud file store (Drive) by name or content. Returns files and folders — look at is_folder to distinguish.",
  schema: z.object({
    query: z.string().min(1),
    mime_type: z.string().optional().describe("Filter by MIME type, e.g. application/pdf"),
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      mime_type: { type: "string" },
      limit: { type: "number" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    const files = await getFilesProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: files.providerName,
      files: await files.search({
        query: input.query,
        mime_type: input.mime_type,
        limit: input.limit,
      }),
    };
  },
});

export const filesListTool = defineTool({
  name: "files_list",
  description: "List direct children of a folder. Omit folder_id for the root.",
  schema: z.object({
    folder_id: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      folder_id: { type: "string" },
      limit: { type: "number" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const files = await getFilesProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: files.providerName,
      files: await files.list(input.folder_id, input.limit),
    };
  },
});

export const filesReadTool = defineTool({
  name: "files_read",
  description:
    "Read the text contents of a file. Google Docs/Sheets/Slides are exported to plain text automatically. Binary files (images, PDFs) return entry metadata but text=null.",
  schema: z.object({
    file_id: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      file_id: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["file_id"],
  },
  async run(input, ctx) {
    const files = await getFilesProvider(ctx.supabase, ctx.userId, input.provider);
    return { provider: files.providerName, ...(await files.read(input.file_id)) };
  },
});

export const filesCreateFolderTool = defineTool({
  name: "files_create_folder",
  description: "Create a new folder under parent_id (or root if omitted).",
  schema: z.object({
    name: z.string().min(1),
    parent_id: z.string().optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      parent_id: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["name"],
  },
  async run(input, ctx) {
    const files = await getFilesProvider(ctx.supabase, ctx.userId, input.provider);
    const folder = await files.createFolder(input.name, input.parent_id);
    return { provider: files.providerName, folder };
  },
});

export const filesShareTool = defineTool({
  name: "files_share",
  description:
    "Create (or fetch) a public share link for a file. Anyone with the link can view. Destructive-ish — confirm with the user for sensitive files.",
  schema: z.object({
    file_id: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      file_id: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["file_id"],
  },
  async run(input, ctx) {
    const files = await getFilesProvider(ctx.supabase, ctx.userId, input.provider);
    return { provider: files.providerName, url: await files.getShareLink(input.file_id) };
  },
});
